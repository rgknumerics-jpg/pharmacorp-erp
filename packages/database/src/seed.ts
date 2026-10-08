import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { DEFAULT_ROLES, PERMISSIONS } from './permissions';
import { withTenant } from './tenant-context';

const prisma = new PrismaClient();

async function main() {
  const tenantName = process.env.SEED_TENANT_NAME ?? 'Pharmacie Pilote';
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  const slug = tenantName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  // Le catalogue de permissions est global (pas de tenant_id), cree une seule fois.
  // Droits crees par ce passage : seuls eux sont ajoutes aux roles existants (les roles sont desormais modifiables
  // dans « Equipe et acces » : on ne reattribue jamais un droit que l'administrateur a retire).
  const newCodes = new Set<string>();
  for (const permission of PERMISSIONS) {
    const exists = await prisma.permission.findUnique({ where: { code: permission.code } });
    if (!exists) newCodes.add(permission.code);
    await prisma.permission.upsert({
      where: { code: permission.code },
      update: { description: permission.description },
      create: permission,
    });
  }

  const tenant = await prisma.tenant.upsert({
    where: { slug },
    update: {},
    create: { name: tenantName, slug, country: 'CG' },
  });

  // "roles", "role_permissions" (indirectement) et "memberships" sont proteges par Row-Level
  // Security (ARCHITECTURE.md section 10) : toute ecriture doit passer par `withTenant`, sans
  // quoi ce script echoue silencieusement (0 ligne affectee) s'il est execute avec le role
  // applicatif "erp_app" plutot qu'avec le role proprietaire "erp" -- ne pas supposer quel
  // role lance le seed (bug trouve pendant la verification du 2026-09-27).
  const roleIdByName: Record<string, string> = {};
  await withTenant(prisma, tenant.id, async (tx) => {
    for (const [roleName, permissionCodes] of Object.entries(DEFAULT_ROLES)) {
      const before = await tx.role.findUnique({ where: { tenantId_name: { tenantId: tenant.id, name: roleName } } });
      const role = await tx.role.upsert({
        where: { tenantId_name: { tenantId: tenant.id, name: roleName } },
        update: {},
        create: { tenantId: tenant.id, name: roleName },
      });
      roleIdByName[roleName] = role.id;

      for (const code of permissionCodes) {
        if (before && !newCodes.has(code)) continue; // role deja existant : on ne touche qu'aux nouveaux droits
        const permission = await tx.permission.findUniqueOrThrow({ where: { code } });
        await tx.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
          update: {},
          create: { roleId: role.id, permissionId: permission.id },
        });
      }
    }
  });

  const passwordHash = await bcrypt.hash(adminPassword, 12);
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: { email: adminEmail, passwordHash, fullName: 'Administrateur' },
  });

  await withTenant(prisma, tenant.id, (tx) =>
    tx.membership.upsert({
      where: { tenantId_userId: { tenantId: tenant.id, userId: admin.id } },
      update: { roleId: roleIdByName.owner },
      create: { tenantId: tenant.id, userId: admin.id, roleId: roleIdByName.owner },
    }),
  );

  console.log(`Seed termine : tenant "${tenant.name}" (${tenant.slug}), admin ${adminEmail}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

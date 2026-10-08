import { useState } from 'react';
import { PageTitle } from '../components/ui';

const DOCS = [
  { file: 'calendrier-obligations-fiscales-sociales-2026-acpce.pdf', title: 'Calendrier des obligations fiscales et sociales 2026', source: 'ACPCE — note du 25/02/2026 (loi de finances 2026)', cat: 'Fiscalité', tags: 'tva its tus cnss camu imf igf patente is iba dsf das echeance 15' },
  { file: 'acte-uniforme-ohada-droit-comptable.pdf', title: 'Acte uniforme OHADA relatif au droit comptable et à l’information financière', source: 'OHADA, 26/01/2017', cat: 'Comptabilité', tags: 'syscohada etats financiers bilan compte de resultat smt systeme normal conservation 10 ans' },
  { file: 'code-securite-sociale-congo.pdf', title: 'Code de sécurité sociale', source: 'République du Congo', cat: 'Social', tags: 'cnss cotisations employeur immatriculation prestations familiales accident du travail pension' },
  { file: 'code-du-travail-congo.pdf', title: 'Code du travail', source: 'République du Congo', cat: 'Social', tags: 'contrat de travail conges licenciement duree du travail salaire' },
  { file: 'convention-collective-officines-pharmacie.pdf', title: 'Convention collective des officines de pharmacie', source: 'Congo', cat: 'Social', tags: 'pharmacie officine categories salaires primes anciennete preparateur' },
  { file: 'loi-19-2005-profession-commercant.pdf', title: 'Loi n° 19-2005 réglementant la profession de commerçant', source: 'République du Congo', cat: 'Juridique', tags: 'commercant registre rccm carte de commercant' },
  { file: 'note-restrictions-activites-commerciales.pdf', title: 'Note technique sur les restrictions légales à l’exercice des activités commerciales', source: 'République du Congo', cat: 'Juridique', tags: 'restrictions etrangers activites reservees' },
  { file: 'modele-bail-usage-professionnel.docx', title: 'Modèle de contrat de bail à usage professionnel', source: 'Modèle', cat: 'Modèles', tags: 'bail loyer local professionnel taxe immobiliere' },
];

export default function Library() {
  const [q, setQ] = useState('');
  const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const list = DOCS.filter((d) => !q || norm(`${d.title} ${d.source} ${d.cat} ${d.tags}`).includes(norm(q)));
  return (
    <>
      <PageTitle title="Bibliothèque juridique et fiscale" sub="Textes de référence à consulter à tout moment (comptabilité, fiscalité, social, droit commercial)" />
      <div className="card mb-3"><input className="w-full" placeholder="🔎 Rechercher : CNSS, TVA, bail, bilan, convention…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="grid gap-3 md:grid-cols-2">
        {list.map((d) => (
          <a key={d.file} href={`/bibliotheque/${d.file}`} target="_blank" rel="noreferrer" className="card block transition hover:shadow">
            <div className="text-xs font-bold uppercase text-brand">{d.cat}</div>
            <div className="font-extrabold">{d.title}</div>
            <div className="text-xs text-ink-muted">{d.source} · {d.file.endsWith('.docx') ? 'Word' : 'PDF'}</div>
          </a>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink-muted">Ces textes sont fournis pour information ; en cas de doute, la version publiée au Journal officiel et l’avis de votre expert-comptable ou de l’administration font foi.</p>
    </>
  );
}
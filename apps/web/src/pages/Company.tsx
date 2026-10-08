import { useEffect, useState } from 'react';
import { api, apiBlob, can } from '../lib/api';
import { dateFr } from '../lib/format';
import { Badge, ErrorBox, Field, PageTitle, useLoad } from '../components/ui';
import { BrandingSection, CustomDocs } from './CompanyBranding';

interface Profile { profile: Record<string, unknown>; documents: { key: string; label?: string | null; fileName: string; createdAt: string }[]; documentTypes: Record<string, string>; completeness: { percent: number; missingFields: string[]; missingDocs: string[] } }

const TEXT: [string, string][] = [['legalName', 'Raison sociale'], ['legalForm', 'Forme juridique'], ['niu', 'NIU'], ['rccm', 'RCCM'], ['practiceAuthorization', 'Autorisation d’exercice'], ['cnssEmployerNumber', 'N° employeur CNSS'], ['patenteNumber', 'N° de patente'], ['address', 'Adresse'], ['city', 'Ville'], ['phone', 'Téléphone'], ['email', 'E-mail']];

export default function Company() {
  const { data, error, reload, setData } = useLoad(() => api<Profile>('/company/profile'));
  const [f, setF] = useState<Record<string, unknown>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (data) setF(data.profile); }, [data]);
  const write = can('company.manage');
  async function save() {
    setErr(null); setMsg(null);
    const body: Record<string, unknown> = {};
    for (const [k] of TEXT) if (f[k]) body[k] = f[k];
    for (const k of ['taxRegime', 'incomeTax', 'zone']) body[k] = f[k];
    for (const k of ['vatRegistered', 'rentsPremises', 'ownsProperty']) body[k] = !!f[k];
    for (const k of ['employeesCount', 'annualRent', 'fiscalYearEndMonth']) body[k] = Number(f[k]) || 0;
    if (!body.fiscalYearEndMonth) body.fiscalYearEndMonth = 12;
    try { setData(await api<Profile>('/company/profile', { method: 'PUT', json: body })); setMsg('Enregistré.'); } catch (e) { setErr((e as Error).message); }
  }
  async function upload(key: string, file?: File) {
    if (!file) return;
    const form = new FormData(); form.append('file', file);
    try { setData(await api<Profile>(`/company/documents/${key}`, { method: 'POST', form })); } catch (e) { setErr((e as Error).message); }
  }
  if (!data) return <ErrorBox error={error} />;
  return (
    <>
      <PageTitle title="Ma structure" sub="Informations légales et documents — tout est facultatif, à compléter quand vous le souhaitez" />
      <div className="card mb-3 flex items-center gap-3"><div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-brand" style={{ width: `${data.completeness.percent}%` }} /></div><b>{data.completeness.percent} %</b></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3">
          <h3 className="font-extrabold">Identité</h3>
          <div className="grid gap-3 md:grid-cols-2">{TEXT.map(([k, l]) => <Field key={k} label={l}><input className="w-full" disabled={!write} value={(f[k] as string) ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}</div>
          <h3 className="pt-2 font-extrabold">Paramètres fiscaux (déterminent votre calendrier)</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Régime"><select className="w-full" disabled={!write} value={(f.taxRegime as string) ?? 'reel'} onChange={(e) => setF({ ...f, taxRegime: e.target.value })}><option value="reel">Réel</option><option value="forfait">Forfaitaire (IGF)</option></select></Field>
            <Field label="Imposition des bénéfices"><select className="w-full" disabled={!write} value={(f.incomeTax as string) ?? 'IS'} onChange={(e) => setF({ ...f, incomeTax: e.target.value })}><option value="IS">IS (société)</option><option value="IBA">IBA (entreprise individuelle)</option></select></Field>
            <Field label="Nombre de salariés"><input type="number" min={0} className="w-full" disabled={!write} value={(f.employeesCount as number) ?? 0} onChange={(e) => setF({ ...f, employeesCount: e.target.value })} /></Field>
            <Field label="Zone (TOL sur salaires)"><select className="w-full" disabled={!write} value={(f.zone as string) ?? 'centre'} onChange={(e) => setF({ ...f, zone: e.target.value })}><option value="centre">Centre-ville</option><option value="peripherie">Périphérie</option></select></Field>
            <Field label="Loyer annuel (taxe immobilière)"><input type="number" min={0} className="w-full" disabled={!write} value={(f.annualRent as number) ?? 0} onChange={(e) => setF({ ...f, annualRent: e.target.value })} /></Field>
          </div>
          <div className="flex flex-wrap gap-4 text-sm font-semibold">
            {[['vatRegistered', 'Assujetti à la TVA'], ['rentsPremises', 'Locataire des locaux'], ['ownsProperty', 'Propriétaire d’immeubles']].map(([k, l]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" disabled={!write} checked={!!f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /> {l}</label>)}
          </div>
          <ErrorBox error={err} />{msg && <Badge>{msg}</Badge>}
          {write && <button className="btn" onClick={save}>Enregistrer</button>}
        </div>
        <div className="card">
          <h3 className="mb-2 font-extrabold">Documents de la structure</h3>
          <table className="w-full"><tbody>
            {Object.entries(data.documentTypes).map(([k, l]) => {
              const d = data.documents.find((x) => x.key === k);
              return <tr key={k}><td><b>{l}</b>{d && <div className="text-xs text-ink-muted">{d.fileName} · {dateFr(d.createdAt)}</div>}</td>
                <td className="text-right">{d ? <button className="btn-alt !py-1" onClick={async () => window.open(URL.createObjectURL(await apiBlob(`/company/documents/${k}`)))}>Voir</button> : <Badge tone="muted">non déposé</Badge>}</td>
                <td>{write && <label className="btn-alt !py-1 cursor-pointer">{d ? 'Remplacer' : 'Déposer'}<input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => upload(k, e.target.files?.[0])} /></label>}</td></tr>;
            })}
          </tbody></table>
        </div>
      </div>
      <CustomDocs docs={data.documents} onChange={(p) => setData(p as Profile)} />
      <BrandingSection />
      <button className="hidden" onClick={reload} />
    </>
  );
}
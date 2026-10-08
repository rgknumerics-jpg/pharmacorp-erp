/**
 * Moteur de conseil « plantes & compléments » — déterministe, sans IA générative.
 * Utilisé tel quel par l'ERP, PHARMACORP Équivalence et PHARMACORP Pharmacies de garde
 * (copié par scripts/sync-apps.cjs ; ne pas modifier les copies, modifier cette source).
 *
 *   const { createEngine } = require('./conseil-engine.cjs');
 *   const engine = createEngine({ plants, rules });
 *   engine.analyse([{ name: 'PANADEX comprimé' }, { name: 'NIFLUGEL gel' }])
 */
'use strict';

const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9'+\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Mot-clé -> regex : début de mot ; mot entier si le mot-clé est court (<= 3 lettres) ou terminé par un espace. */
function kwRegex(kw) {
  const k = norm(kw);
  if (!k) return null;
  const whole = k.length <= 3 || /\s$/.test(String(kw));
  return new RegExp(`(^|[^a-z0-9])${esc(k)}${whole ? '($|[^a-z0-9])' : ''}`);
}

function compileList(list) {
  return (list || []).map(kwRegex).filter(Boolean);
}

function createEngine({ plants, rules }) {
  const byId = new Map(plants.map((p) => [p.id, p]));
  const classRx = Object.fromEntries(Object.entries(rules.classes).map(([k, v]) => [k, compileList(v)]));
  const triggers = rules.declencheurs.map((t) => ({ ...t, rx: compileList(t.mots) }));
  const plantRx = {};
  for (const b of Object.values(rules.besoins)) {
    for (const p of b.plantes) plantRx[p.id] = plantRx[p.id] || compileList(p.motsCles);
  }

  const itemText = (it) => norm(`${it.name || ''} ${it.dci || ''} ${it.form || ''}`);
  const testAny = (rxs, text) => rxs.some((r) => r.test(text));

  function classesOf(texts) {
    const found = new Set();
    for (const t of texts) for (const [c, rxs] of Object.entries(classRx)) if (testAny(rxs, t)) found.add(c);
    return [...found];
  }

  function scoreBesoins(texts) {
    const out = {};
    texts.forEach((t, idx) => {
      const best = {};
      for (const tr of triggers) {
        if (testAny(tr.rx, t) && (best[tr.besoin]?.poids ?? 0) < tr.poids) best[tr.besoin] = { poids: tr.poids, libelle: tr.libelle };
      }
      for (const [b, v] of Object.entries(best)) {
        const o = (out[b] ||= { score: 0, declenche: [] });
        o.score += v.poids;
        o.declenche.push({ index: idx, type: v.libelle });
      }
    });
    return out;
  }

  function light(p) {
    return p && { id: p.id, nom: p.nom, nomLatin: p.nomLatin, famille: p.famille };
  }

  /** items : [{ name, dci?, form? }] ; opts : { pregnant?, child?, max? } */
  function analyse(items, opts = {}) {
    const texts = (items || []).map(itemText);
    const classes = classesOf(texts);
    const out = {
      avertissement: rules.avertissement,
      classes,
      besoins: [],
      suggestions: [],
      ecartees: [],
      suppression: null,
    };
    const sup = (rules.suppression?.classes || []).filter((c) => classes.includes(c));
    if (sup.length) {
      out.suppression = { classes: sup, message: rules.suppression.message };
      return out;
    }

    const scores = scoreBesoins(texts);
    const max = opts.max || 4;
    const seen = new Set();
    for (const [bid, sc] of Object.entries(scores).sort((a, b) => b[1].score - a[1].score)) {
      if (sc.score < 1) continue;
      const b = rules.besoins[bid];
      if (!b) continue;
      out.besoins.push({ id: bid, libelle: b.libelle, pourquoi: b.pourquoi, questions: b.questions, score: sc.score, intensite: sc.score >= 2 ? 'forte' : 'normale', declenche: sc.declenche.map((d) => ({ produit: items[d.index].name, type: d.type })) });
      let n = 0;
      for (const cand of [...b.plantes].sort((x, y) => x.priorite - y.priorite)) {
        if (n >= 3 || out.suggestions.length >= max) break;
        if (seen.has(cand.id)) continue;
        const plant = byId.get(cand.id);
        if (!plant) continue;
        if (texts.some((t) => testAny(plantRx[cand.id] || [], t))) { // déjà au panier
          seen.add(cand.id);
          continue;
        }
        const meta = rules.meta?.[cand.id] || {};
        const alertes = [];
        let ecarte = null;
        for (const it of rules.interactions) {
          if (!it.plantes.includes(cand.id)) continue;
          if (!it.classes.some((c) => classes.includes(c))) continue;
          if (it.niveau === 'eviter') ecarte = it.message;
          else alertes.push(it.message);
        }
        if (opts.pregnant && meta.grossesse === 'deconseille') ecarte = ecarte || 'Déconseillé pendant la grossesse / l’allaitement.';
        if (opts.child && meta.enfant === 'deconseille') ecarte = ecarte || 'Déconseillé chez l’enfant.';
        if (ecarte) {
          out.ecartees.push({ plante: light(plant), besoin: bid, raison: ecarte });
          continue;
        }
        if (meta.grossesse === 'deconseille') alertes.push('Déconseillé pendant la grossesse et l’allaitement.');
        else if (meta.grossesse === 'avis') alertes.push('Grossesse / allaitement : avis du pharmacien.');
        if (meta.enfant === 'deconseille') alertes.push('Déconseillé chez l’enfant.');
        else if (meta.enfant === 'avis') alertes.push('Enfant : avis du pharmacien.');
        seen.add(cand.id);
        n++;
        out.suggestions.push({
          besoin: bid,
          besoinLibelle: b.libelle,
          plante: light(plant),
          note: cand.note,
          motsCles: cand.motsCles,
          alertes,
          contreIndications: meta.contreIndications || [],
          connaissances: plant.connaissances || null,
          securite: plant.securite || null,
        });
      }
    }
    return out;
  }

  /** Plantes (fiches allégées) contenant déjà ce produit (mots-clés) : pour la fiche produit. */
  function plantsInProduct(item) {
    const t = itemText(item);
    const ids = new Set();
    for (const [pid, rxs] of Object.entries(plantRx)) if (testAny(rxs, t)) ids.add(pid);
    return [...ids].map((id) => byId.get(id)).filter(Boolean);
  }

  /** Interactions applicables à une plante selon les classes de médicaments données. */
  function interactionsFor(plantId, classes) {
    return rules.interactions
      .filter((it) => it.plantes.includes(plantId) && it.classes.some((c) => classes.includes(c)))
      .map((it) => ({ niveau: it.niveau, message: it.message }));
  }

  function search(q, { limit = 30, offset = 0 } = {}) {
    const terms = norm(q).split(' ').filter((t) => t.length > 1);
    if (!terms.length) return { total: 0, resultats: [] };
    const scored = [];
    for (const p of plants) {
      const names = norm([p.nom, p.nomLatin, (p.nomsCommuns || []).join(' '), (p.nomsAnglais || []).join(' ')].join(' '));
      const usages = norm([p.usagesTexte, (p.usagesListe || []).join(' '), p.resume].join(' '));
      let s = 0;
      let ok = true;
      for (const t of terms) {
        const inName = names.includes(t);
        const inUse = usages.includes(t);
        if (!inName && !inUse && !norm(p.famille).includes(t)) { ok = false; break; }
        s += (inName ? 5 : 0) + (inUse ? 1 + Math.min(3, usages.split(t).length - 1) : 0);
      }
      if (ok) scored.push({ p, s });
    }
    scored.sort((a, b) => b.s - a.s || a.p.nom.localeCompare(b.p.nom));
    return { total: scored.length, resultats: scored.slice(offset, offset + limit).map((x) => ({ ...summary(x.p), score: x.s })) };
  }

  function summary(p) {
    return { id: p.id, nom: p.nom, nomLatin: p.nomLatin, famille: p.famille, resume: p.resume && p.resume.length > 220 ? `${p.resume.slice(0, 220).replace(/\s+\S*$/, '')} […]` : p.resume, toxique: !!p.toxique };
  }

  /** Plante du jour : choix déterministe parmi les plantes couvertes par les règles (date AAAA-MM-JJ). */
  function plantOfTheDay(dateStr) {
    const ids = [...new Set(Object.values(rules.besoins).flatMap((b) => b.plantes.map((p) => p.id)))].filter((id) => byId.has(id) && (byId.get(id).resume || byId.get(id).usagesTexte)).sort();
    const d = dateStr || new Date().toISOString().slice(0, 10);
    let h = 0;
    for (const c of d) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const id = ids[h % ids.length];
    const p = byId.get(id);
    const meta = rules.meta?.[id] || {};
    const besoins = Object.entries(rules.besoins).filter(([, b]) => b.plantes.some((x) => x.id === id)).map(([bid, b]) => ({ id: bid, libelle: b.libelle }));
    return { date: d, plante: p, contreIndications: meta.contreIndications || [], grossesse: meta.grossesse, enfant: meta.enfant, besoins, avertissement: rules.avertissement };
  }

  return { analyse, plantsInProduct, interactionsFor, search, plantOfTheDay, get: (id) => byId.get(id) || null, summary, classesOf: (items) => classesOf((items || []).map(itemText)), rules, count: plants.length };
}

module.exports = { createEngine, norm };

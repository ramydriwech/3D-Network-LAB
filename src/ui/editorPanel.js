// Onglet « Construire » : éditeur de topologie (demande du superviseur).
//
// Deux modes : EXPLORER (les scénarios du catalogue, comme avant) et CONSTRUIRE (un
// brouillon que l'on modifie). Chaque modification passe par src/sim/builder.js (fonctions
// pures), est ajoutée à l'historique (annuler / rétablir), enregistrée automatiquement dans
// le navigateur, puis rechargée dans la simulation : la scène, le diagnostic et la fiche
// technique suivent donc toujours le brouillon.
//
// Dans la scène : glisser un équipement le déplace ; avec l'outil « Relier », cliquer deux
// équipements les câble ; cliquer un équipement ouvre ses réglages ici.

import { Topics } from '../sim/events.js';
import { CABLES, DEFAULT_CABLE, MODELS, SYSTEMS, cableSummary, formatSpeed, modelsOfType } from '../sim/catalog.js';
import { diagnose } from '../sim/diagnostic.js';
import * as B from '../sim/builder.js';
import { el } from './dom.js';
import { localize, onLangChange, registerStrings, t } from './i18n.js';
import { toast } from './toast.js';

registerStrings({
  fr: {
    'ed.tab': 'Construire',
    'ed.title': 'Construire un réseau',
    'ed.intro': 'Créez votre propre topologie : ajoutez des équipements, reliez-les, réglez les adresses, puis lancez un échange. Tout est enregistré automatiquement dans ce navigateur.',
    'ed.new': 'Nouveau réseau vide', 'ed.edit': 'Modifier le scénario affiché', 'ed.resume': 'Reprendre le brouillon ({n} équipements)',
    'ed.saved': 'Mes réseaux enregistrés', 'ed.open': 'Ouvrir', 'ed.delete': 'Supprimer',
    'ed.undo': 'Annuler', 'ed.redo': 'Rétablir', 'ed.auto': 'Adressage automatique', 'ed.export': 'Exporter (JSON)', 'ed.import': 'Importer (JSON)',
    'ed.save': 'Enregistrer sous…', 'ed.saveName': 'Nom du réseau', 'ed.quit': 'Quitter l\'éditeur',
    'ed.add': 'Ajouter un équipement', 'ed.model': 'Modèle',
    'ed.type.host': 'PC', 'ed.type.server': 'Serveur', 'ed.type.switch': 'Switch', 'ed.type.router': 'Routeur', 'ed.type.firewall': 'Pare-feu',
    'ed.os': 'Système : {os} (commandes de style {dialect})', 'ed.noOs': 'Non administrable : pas de console.', 'ed.console': 'Console de {name}',
    'ed.link': 'Relier deux équipements', 'ed.linkOn': 'Cliquez le premier équipement…', 'ed.linkSecond': '{name} choisi : cliquez le second équipement.',
    'ed.linkOff': 'Outil « Relier »', 'ed.cable': 'Câble',
    'ed.hintDrag': 'Astuce : glissez un équipement dans la scène pour le déplacer.',
    'ed.device': 'Réglages de {name}', 'ed.pick': 'Cliquez un équipement dans la scène pour le régler.',
    'ed.name': 'Nom', 'ed.address': 'Adresse IP / préfixe', 'ed.suggest': 'Proposer', 'ed.apply': 'Appliquer', 'ed.clear': 'Effacer',
    'ed.gateway': 'Passerelle', 'ed.dns': 'Serveur DNS',
    'ed.routes': 'Routes statiques', 'ed.route.add': 'Ajouter la route', 'ed.route.network': 'Réseau', 'ed.route.via': 'via',
    'ed.roles': 'Rôles', 'ed.role.dhcp': 'Serveur DHCP', 'ed.role.dns': 'Serveur DNS', 'ed.role.http': 'Serveur web (HTTP)', 'ed.role.tcp': 'Écoute TCP 5000',
    'ed.cables': 'Câbles', 'ed.removeDevice': 'Supprimer cet équipement', 'ed.removeLink': 'Retirer',
    'ed.play': 'Lancer un échange', 'ed.action': 'Échange', 'ed.from': 'De', 'ed.to': 'Vers',
    'ed.act.ping': 'Ping (ICMP)', 'ed.act.tcp': 'Transfert TCP (14 600 octets)', 'ed.act.udp': 'Message UDP', 'ed.act.dns': 'Requête DNS', 'ed.act.http': 'Page web (HTTP)', 'ed.act.dhcp': 'Demande DHCP',
    'ed.run': 'Lancer', 'ed.keep': 'Ajouter aux étapes', 'ed.steps': 'Étapes du réseau : {n}',
    'ed.loop': 'Attention : boucle entre switchs. Les diffusions vont tourner en rond jusqu\'à ce que le simulateur les arrête (voir le Diagnostic).',
    'ed.stepAdded': 'Étape ajoutée : elle sera jouée avec « Lecture ».',
    'ed.autoDone': '{n} réglage(s) ajouté(s) automatiquement.', 'ed.autoNone': 'Rien à ajouter : tout est déjà réglé.',
    'ed.imported': 'Réseau importé.', 'ed.savedAs': 'Enregistré sous « {name} ».',
    'ed.storage': 'Ce navigateur n\'autorise pas l\'enregistrement : pensez à exporter votre réseau.',
    'ed.empty': 'Le réseau est vide : ajoutez un premier équipement.',
  },
  en: {
    'ed.tab': 'Build',
    'ed.title': 'Build a network',
    'ed.intro': 'Create your own topology: add devices, connect them, set the addresses, then start an exchange. Everything is saved automatically in this browser.',
    'ed.new': 'New empty network', 'ed.edit': 'Edit the displayed scenario', 'ed.resume': 'Resume the draft ({n} devices)',
    'ed.saved': 'My saved networks', 'ed.open': 'Open', 'ed.delete': 'Delete',
    'ed.undo': 'Undo', 'ed.redo': 'Redo', 'ed.auto': 'Automatic addressing', 'ed.export': 'Export (JSON)', 'ed.import': 'Import (JSON)',
    'ed.save': 'Save as…', 'ed.saveName': 'Network name', 'ed.quit': 'Leave the editor',
    'ed.add': 'Add a device', 'ed.model': 'Model',
    'ed.type.host': 'PC', 'ed.type.server': 'Server', 'ed.type.switch': 'Switch', 'ed.type.router': 'Router', 'ed.type.firewall': 'Firewall',
    'ed.os': 'System: {os} ({dialect}-style commands)', 'ed.noOs': 'Unmanaged: no console.', 'ed.console': '{name} console',
    'ed.link': 'Connect two devices', 'ed.linkOn': 'Click the first device…', 'ed.linkSecond': '{name} chosen: click the second device.',
    'ed.linkOff': '"Connect" tool', 'ed.cable': 'Cable',
    'ed.hintDrag': 'Tip: drag a device in the scene to move it.',
    'ed.device': '{name} settings', 'ed.pick': 'Click a device in the scene to configure it.',
    'ed.name': 'Name', 'ed.address': 'IP address / prefix', 'ed.suggest': 'Suggest', 'ed.apply': 'Apply', 'ed.clear': 'Clear',
    'ed.gateway': 'Gateway', 'ed.dns': 'DNS server',
    'ed.routes': 'Static routes', 'ed.route.add': 'Add the route', 'ed.route.network': 'Network', 'ed.route.via': 'via',
    'ed.roles': 'Roles', 'ed.role.dhcp': 'DHCP server', 'ed.role.dns': 'DNS server', 'ed.role.http': 'Web server (HTTP)', 'ed.role.tcp': 'Listens on TCP 5000',
    'ed.cables': 'Cables', 'ed.removeDevice': 'Delete this device', 'ed.removeLink': 'Remove',
    'ed.play': 'Start an exchange', 'ed.action': 'Exchange', 'ed.from': 'From', 'ed.to': 'To',
    'ed.act.ping': 'Ping (ICMP)', 'ed.act.tcp': 'TCP transfer (14,600 bytes)', 'ed.act.udp': 'UDP message', 'ed.act.dns': 'DNS query', 'ed.act.http': 'Web page (HTTP)', 'ed.act.dhcp': 'DHCP request',
    'ed.run': 'Start', 'ed.keep': 'Add to the steps', 'ed.steps': 'Network steps: {n}',
    'ed.loop': 'Warning: loop between switches. Broadcasts will go round in circles until the simulator stops them (see the Diagnostic).',
    'ed.stepAdded': 'Step added: it will play with "Play".',
    'ed.autoDone': '{n} setting(s) added automatically.', 'ed.autoNone': 'Nothing to add: everything is already set.',
    'ed.imported': 'Network imported.', 'ed.savedAs': 'Saved as "{name}".',
    'ed.storage': 'This browser does not allow saving: remember to export your network.',
    'ed.empty': 'The network is empty: add a first device.',
  },
});

const DRAFT_KEY = 'ntopo.editor.draft';
const SAVES_KEY = 'ntopo.editor.saves';
const ACTIONS = ['ping', 'tcp', 'udp', 'dns', 'http', 'dhcp'];
const TYPES = ['host', 'server', 'switch', 'router', 'firewall'];

// Le stockage du navigateur peut être absent ou refusé (navigation privée, iframe) :
// on ne plante jamais, on prévient une fois.
let storageWarned = false;
function storage(action) {
  try { return action(window.localStorage); } catch {
    if (!storageWarned) { storageWarned = true; toast(t('ed.storage'), { kind: 'error' }); }
    return null;
  }
}
const readJson = (key, fallback) => storage((store) => JSON.parse(store.getItem(key) || 'null')) || fallback;
const writeJson = (key, value) => storage((store) => store.setItem(key, JSON.stringify(value)));

export function initEditorPanel(app, slot = document.getElementById('editor')) {
  const { sim } = app;
  let history = null; // null : on n'édite pas
  let selected = null; // équipement réglé
  let linking = null; // null | { first: id | null }
  let committing = false; // rechargement du brouillon en cours
  let reselecting = false; // l'éditeur rétablit lui-même la sélection
  let cable = DEFAULT_CABLE;
  let play = { action: 'ping', from: '', to: '' };
  const addModel = Object.fromEntries(TYPES.map((type) => [type, modelsOfType(type)[0].id]));

  const draft = () => (history ? history.present : null);
  const nameOf = (id) => { const def = draft() && draft().devices.find((d) => d.id === id); return def ? def.name : id; };
  const fail = (error) => toast(error.text ? localize(error.text) : error.message, { kind: 'error' });

  /** Charge le brouillon dans la simulation (la scène et les autres panneaux suivent). */
  async function show(scenario) {
    committing = true;
    try {
      await sim.loadScenario(scenario);
      // La sélection est rétablie sans compter comme un clic (outil « Relier »).
      if (!linking && selected && scenario.devices.some((d) => d.id === selected) && app.selection) {
        reselecting = true;
        try { app.selection.select({ kind: 'device', id: selected }); } finally { reselecting = false; }
      }
    } catch (error) {
      fail(error);
    } finally {
      committing = false;
    }
    writeJson(DRAFT_KEY, scenario);
    if (app.render) {
      app.render.keepCamera = true;
      if (app.render.ensureVisible) app.render.ensureVisible(); // un nouvel équipement hors champ : on recadre
    }
    paint();
  }

  /** Applique une modification : fonction (brouillon) → nouveau brouillon. */
  function change(operation) {
    if (!history) return;
    try {
      const next = operation(history.present);
      if (!next || next === history.present) return;
      history.push(next);
      show(next);
    } catch (error) {
      fail(error);
    }
  }

  function start(scenario) {
    if (app.render) app.render.keepCamera = false; // premier affichage : on cadre le réseau
    history = new B.History(scenario);
    selected = null;
    linking = null;
    if (app.tabs) app.tabs.select('build');
    show(scenario);
  }

  async function quit() {
    if (app.render) app.render.keepCamera = false;
    history = null;
    selected = null;
    linking = null;
    const entry = (app.catalog && app.catalog.default) || null;
    if (entry) await app.loadScenario(entry);
    paint();
  }

  // ------------------------------------------------------------------ morceaux d'interface
  const button = (key, onclick, extra = {}) => el('button', { type: 'button', class: 'btn', onclick, ...extra }, t(key));
  const field = (labelKey, input) => el('label', { class: 'ed-field' }, el('span', {}, t(labelKey)), input);
  const select = (options, value, onchange) => {
    const node = el('select', { onchange: (event) => onchange(event.target.value) }, options.map(([v, label]) => el('option', { value: v }, label)));
    node.value = value;
    return node;
  };

  function startView() {
    const saved = readJson(DRAFT_KEY, null);
    const saves = readJson(SAVES_KEY, {});
    const parts = [
      el('p', { class: 'muted small' }, t('ed.intro')),
      el('div', { class: 'ed-row' },
        button('ed.new', () => start(B.emptyDraft()), { class: 'btn btn-primary', id: 'ed-new' }),
        sim.scenario ? button('ed.edit', () => start(B.draftFrom(sim.scenario)), { id: 'ed-edit' }) : null),
    ];
    if (saved && saved.devices && saved.devices.length) {
      parts.push(el('button', { type: 'button', class: 'btn btn-wide', id: 'ed-resume', onclick: () => start(saved) }, t('ed.resume', { n: saved.devices.length })));
    }
    parts.push(importButton());
    const names = Object.keys(saves);
    if (names.length) {
      parts.push(el('h3', { class: 'sub-title' }, t('ed.saved')));
      parts.push(el('ul', { class: 'ed-saves' }, names.map((name) => el('li', {},
        el('span', {}, name),
        button('ed.open', () => start(saves[name])),
        button('ed.delete', () => { delete saves[name]; writeJson(SAVES_KEY, saves); paint(); })))));
    }
    return parts;
  }

  function importButton() {
    const input = el('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        const scenario = B.importJson(await file.text());
        if (history) change(() => scenario); else start(scenario);
        toast(t('ed.imported'));
      } catch (error) { fail(error); }
    } });
    return el('span', {}, input, button('ed.import', () => input.click(), { id: 'ed-import' }));
  }

  function toolbar() {
    return el('div', { class: 'ed-row ed-toolbar' },
      button('ed.undo', () => { const back = history.undo(); if (back) show(back); }, { disabled: !history.canUndo, id: 'ed-undo' }),
      button('ed.redo', () => { const next = history.redo(); if (next) show(next); }, { disabled: !history.canRedo, id: 'ed-redo' }),
      button('ed.auto', () => {
        let count = 0;
        change((d) => { const result = B.autoAddress(d); count = result.changes; return count ? result.draft : d; });
        toast(count ? t('ed.autoDone', { n: count }) : t('ed.autoNone'));
      }, { id: 'ed-auto', disabled: !draft().links.length }),
      button('ed.export', exportDraft, { id: 'ed-export' }),
      importButton(),
      button('ed.save', saveAs, { id: 'ed-save' }),
      button('ed.quit', quit, { id: 'ed-quit' }));
  }

  function exportDraft() {
    const blob = new Blob([B.exportJson(draft())], { type: 'application/json' });
    const link = el('a', { href: URL.createObjectURL(blob), download: `${draft().id}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function saveAs() {
    const name = (window.prompt(t('ed.saveName'), localize(draft().title)) || '').trim();
    if (!name) return;
    const saves = readJson(SAVES_KEY, {});
    const scenario = { ...draft(), title: { fr: name, en: name } };
    saves[name] = scenario;
    writeJson(SAVES_KEY, saves);
    history.push(scenario);
    show(scenario);
    toast(t('ed.savedAs', { name }));
  }

  /** Fiche d'un modèle : description, ports, système et style de commandes. */
  function modelCard(id) {
    const model = MODELS[id];
    if (!model) return null;
    const ports = model.ports.map((g) => `${g.count}×${formatSpeed(g.speed)}`).join(' + ');
    const os = model.os ? SYSTEMS[model.os] : (model.type === 'host' || model.type === 'server') ? SYSTEMS.desk : null;
    return el('div', { class: 'ed-model-card' },
      el('strong', {}, model.name), el('span', { class: 'muted small' }, ` · ${ports}`),
      el('p', { class: 'small' }, localize(model.description)),
      el('p', { class: 'muted small' }, !os ? t('ed.noOs') : os.dialect === 'pc' ? os.name : t('ed.os', { os: os.name, dialect: os.dialect.toUpperCase() })));
  }

  function palette() {
    return [
      el('h3', { class: 'sub-title' }, t('ed.add')),
      el('div', { class: 'ed-palette' }, TYPES.map((type) => el('div', { class: 'ed-add' },
        select(modelsOfType(type).map((m) => [m.id, `${m.name}`]), addModel[type], (value) => { addModel[type] = value; paint(); }),
        el('button', { type: 'button', class: `btn btn-add tag-${type}`, id: `ed-add-${type}`, onclick: () => {
          let created = null;
          change((d) => {
            const near = selected && d.devices.find((x) => x.id === selected);
            const result = B.addDevice(d, type, { model: addModel[type], position: near ? B.freePosition(d, near.position) : undefined });
            created = result.id;
            return result.draft;
          });
          if (created) selected = created; // sélectionné dès que le brouillon est rechargé
        } }, '+ ', t('ed.type.' + type)),
        modelCard(addModel[type])))),
      el('h3', { class: 'sub-title' }, t('ed.link')),
      el('div', { class: 'ed-row' },
        el('button', { type: 'button', id: 'ed-link', class: `btn ${linking ? 'btn-primary' : ''}`, 'aria-pressed': String(!!linking),
          onclick: () => { linking = linking ? null : { first: null }; paint(); } },
        linking ? (linking.first ? t('ed.linkSecond', { name: nameOf(linking.first) }) : t('ed.linkOn')) : t('ed.linkOff')),
        field('ed.cable', select(Object.entries(CABLES).map(([id, c]) => [id, c.name]), cable, (value) => { cable = value; paint(); }))),
      // Fiche du câble choisi (catalogue) : vitesse, portée, à quoi il sert.
      el('p', { class: 'small ed-cable-card' }, el('strong', {}, CABLES[cable].name), ` — ${localize(cableSummary(cable))}. ${localize(CABLES[cable].description)}`),
      el('p', { class: 'muted small' }, t('ed.hintDrag')),
    ];
  }

  function deviceView() {
    const d = draft();
    const def = selected && d.devices.find((x) => x.id === selected);
    if (!def) return [el('p', { class: 'muted' }, d.devices.length ? t('ed.pick') : t('ed.empty'))];
    const parts = [el('h3', { class: 'sub-title' }, t('ed.device', { name: def.name }))];
    const name = el('input', { value: def.name, size: 10, id: 'ed-name' });
    parts.push(el('div', { class: 'ed-row' }, field('ed.name', name),
      button('ed.apply', () => change((x) => B.updateDevice(x, def.id, { name: name.value })))));
    parts.push(field('ed.model', select(modelsOfType(def.type).map((m) => [m.id, `${m.name} — ${m.ports.map((g) => `${g.count}×${formatSpeed(g.speed)}`).join(' + ')}`]),
      def.model || '', (value) => change((x) => B.updateDevice(x, def.id, { model: value })))));
    if (MODELS[def.model]) parts.push(modelCard(def.model));
    if (app.terminals) parts.push(el('button', { type: 'button', class: 'btn btn-primary btn-wide', id: 'ed-console', onclick: () => app.terminals.open(def.id) }, '>_ ', t('ed.console', { name: def.name })));

    // Adresses
    if (def.type !== 'switch') {
      parts.push(el('h4', {}, t('ed.address')));
      for (const iface of def.interfaces || []) {
        const ip = el('input', { value: iface.ip || '', placeholder: '192.168.1.10', size: 13, class: 'ed-ip', 'data-iface': iface.name });
        const prefix = el('input', { value: iface.prefix || 24, type: 'number', min: 1, max: 30, class: 'ed-prefix' });
        parts.push(el('div', { class: 'ed-row ed-iface' },
          el('code', {}, iface.name), ip, el('span', {}, '/'), prefix,
          button('ed.suggest', () => {
            const s = B.suggestAddress(draft(), def.id, iface.name);
            if (s) { ip.value = s.ip; prefix.value = s.prefix; }
          }),
          button('ed.apply', () => change((x) => B.setAddress(x, def.id, iface.name, ip.value.trim(), Number(prefix.value)))),
          iface.ip ? button('ed.clear', () => change((x) => B.setAddress(x, def.id, iface.name, null))) : null));
      }
    }
    // Passerelle et DNS (postes et serveurs)
    if (def.type === 'host' || def.type === 'server') {
      for (const key of ['gateway', 'dns']) {
        const input = el('input', { value: def[key] || '', size: 13, id: `ed-${key}` });
        parts.push(el('div', { class: 'ed-row' }, field(`ed.${key}`, input),
          key === 'gateway' ? button('ed.suggest', () => { input.value = B.suggestGateway(draft(), def.id) || ''; }) : null,
          button('ed.apply', () => change((x) => B.updateDevice(x, def.id, { [key]: input.value.trim() || null })))));
      }
      parts.push(el('h4', {}, t('ed.roles')));
      parts.push(el('div', { class: 'ed-roles' }, B.ROLES.map((role) => el('label', {},
        el('input', { type: 'checkbox', checked: !!(def.services && def.services[role]), onchange: (event) => change((x) => B.setService(x, def.id, role, event.target.checked)) }),
        ' ', t('ed.role.' + role)))));
    }
    // Routes (routeurs)
    if (def.type === 'router') {
      parts.push(el('h4', {}, t('ed.routes')));
      const routes = def.routes || [];
      parts.push(el('ul', { class: 'ed-routes' }, routes.map((route, i) => el('li', {},
        el('code', {}, `${route.network}/${route.prefix} via ${route.via}`),
        button('ed.removeLink', () => change((x) => B.setRoutes(x, def.id, routes.filter((_, j) => j !== i))))))));
      const net = el('input', { placeholder: '192.168.2.0', size: 12 });
      const pre = el('input', { type: 'number', value: 24, min: 0, max: 30, class: 'ed-prefix' });
      const via = el('input', { placeholder: '10.0.0.2', size: 11 });
      parts.push(el('div', { class: 'ed-row' }, net, el('span', {}, '/'), pre, el('span', {}, t('ed.route.via')), via,
        button('ed.route.add', () => change((x) => B.setRoutes(x, def.id, [...routes, { network: net.value.trim(), prefix: Number(pre.value), via: via.value.trim() }])))));
      const missing = diagnose(d).findings.filter((f) => f.fix && f.fix.op === 'addRoute' && f.fix.device === def.id);
      if (missing.length) {
        parts.push(el('button', { type: 'button', class: 'btn btn-wide', id: 'ed-suggest-routes', onclick: () => change((x) => B.setRoutes(x, def.id, [...routes, ...missing.map((f) => f.fix.route)])) },
          `${t('ed.suggest')} : ${missing.map((f) => `${f.fix.route.network}/${f.fix.route.prefix} via ${f.fix.route.via}`).join(', ')}`));
      }
    }
    // Câbles de l'équipement
    const own = d.links.filter((link) => link.a.startsWith(def.id + ':') || link.b.startsWith(def.id + ':'));
    if (own.length) {
      parts.push(el('h4', {}, t('ed.cables')));
      parts.push(el('ul', { class: 'ed-cables' }, own.map((link) => {
        const mine = link.a.startsWith(def.id + ':') ? link.a : link.b;
        const other = mine === link.a ? link.b : link.a;
        return el('li', {},
          el('code', {}, `${mine.split(':')[1]} → ${nameOf(other.split(':')[0])} (${other.split(':')[1]})`),
          select(Object.entries(CABLES).map(([id, c]) => [id, c.name]), link.cable || DEFAULT_CABLE, (value) => change((x) => B.updateLink(x, link.id, { cable: value }))),
          button('ed.removeLink', () => change((x) => B.removeLink(x, link.id))));
      })));
    }
    parts.push(el('button', { type: 'button', class: 'btn btn-danger btn-wide', id: 'ed-remove', onclick: () => {
      const id = def.id;
      selected = null;
      change((x) => B.removeDevice(x, id));
    } }, t('ed.removeDevice')));
    return parts;
  }

  function stepFor() {
    const step = { action: play.action, from: play.from };
    if (['ping', 'tcp', 'udp'].includes(play.action)) step.to = play.to;
    if (play.action === 'tcp') { step.port = 5000; step.size = 14600; step.window = 4; }
    if (play.action === 'udp') { step.port = 5005; step.data = 'Bonjour'; }
    if (play.action === 'dns') step.name = `${nameOf(play.to).toLowerCase()}.lan`;
    if (play.action === 'http') step.url = `http://${nameOf(play.to).toLowerCase()}.lan/`;
    step.title = { fr: `${t('ed.act.' + play.action)} : ${nameOf(play.from)}${step.to || play.action !== 'dhcp' ? ' → ' + nameOf(play.to) : ''}`, en: `${play.action.toUpperCase()}: ${nameOf(play.from)}${play.action !== 'dhcp' ? ' → ' + nameOf(play.to) : ''}` };
    return step;
  }

  function playView() {
    const d = draft();
    const endpoints = d.devices.filter((def) => def.type === 'host' || def.type === 'server');
    if (endpoints.length < 1) return [];
    if (!endpoints.some((def) => def.id === play.from)) play.from = endpoints[0].id;
    if (!endpoints.some((def) => def.id === play.to) || play.to === play.from) {
      play.to = (endpoints.find((def) => def.id !== play.from) || endpoints[0]).id;
    }
    const options = endpoints.map((def) => [def.id, def.name]);
    const blocked = () => diagnose(d).findings.some((f) => f.id.startsWith('loop'));
    return [
      el('h3', { class: 'sub-title' }, t('ed.play')),
      el('div', { class: 'ed-row' },
        field('ed.action', select(ACTIONS.map((a) => [a, t('ed.act.' + a)]), play.action, (value) => { play.action = value; paint(); })),
        field('ed.from', select(options, play.from, (value) => { play.from = value; })),
        play.action === 'dhcp' ? null : field('ed.to', select(options, play.to, (value) => { play.to = value; }))),
      el('div', { class: 'ed-row' },
        el('button', { type: 'button', class: 'btn btn-primary', id: 'ed-run', onclick: () => {
          if (blocked()) toast(t('ed.loop'), { kind: 'error' });
          sim.runAction(stepFor());
        } }, t('ed.run')),
        button('ed.keep', () => { change((x) => B.addStep(x, stepFor())); toast(t('ed.stepAdded')); }, { id: 'ed-keep' }),
        el('span', { class: 'muted small' }, t('ed.steps', { n: d.steps.length }))),
    ];
  }

  function paint() {
    const title = el('h2', { class: 'panel-title' }, t('ed.title'));
    if (!history) { slot.replaceChildren(title, ...startView()); return; }
    slot.replaceChildren(title, toolbar(), ...palette(), ...deviceView(), ...playView());
  }

  // ------------------------------------------------------------------ liens avec la scène
  sim.on(Topics.SELECT, (event) => {
    // Ce que l'éditeur provoque lui-même (désélection au rechargement, sélection rétablie)
    // n'est pas un clic de l'utilisateur.
    if (reselecting || (committing && event.kind === null)) return;
    if (!history || event.kind !== 'device') {
      if (history && event.kind === null && !linking) { selected = null; paint(); }
      return;
    }
    if (linking) {
      if (!linking.first) { linking.first = event.id; paint(); return; }
      if (linking.first === event.id) return;
      const first = linking.first;
      linking = { first: null };
      change((d) => B.addLink(d, first, event.id, { cable }).draft);
      return;
    }
    if (selected !== event.id) { selected = event.id; paint(); }
  });

  sim.on(Topics.SCENARIO_LOADED, ({ scenario }) => {
    if (!history) { paint(); return; } // le bouton « Modifier le scénario affiché » suit le scénario
    if (committing) return;
    if (scenario.id === history.present.id) {
      // Le brouillon a été corrigé ailleurs (diagnostic) : on garde la correction dans l'historique.
      history.push(scenario);
      writeJson(DRAFT_KEY, scenario);
      paint();
    } else {
      history = null; // un scénario du catalogue a été choisi : on quitte l'éditeur
      if (app.render) app.render.keepCamera = false;
      selected = null;
      linking = null;
      paint();
    }
  });
  onLangChange(paint);

  if (app.tabs) app.tabs.add({ id: 'build', label: 'ed.tab', panels: ['editor'] });

  // Glisser-déposer dans la scène (actif seulement dans l'onglet Construire).
  if (app.render && app.render.domElement) {
    // Onglet Construire : on choisit les câbles, donc on voit le type et la vitesse de chacun.
    if (app.tabs && app.tabs.onChange) {
      app.tabs.onChange((id) => { if (app.render && app.render.linkLoad && app.render.linkLoad.setShowAll) app.render.linkLoad.setShowAll(id === 'build'); });
    }
    import('../render/dragControls.js').then(({ createDragControls }) => {
      createDragControls(app.render, sim, {
        enabled: () => !!history && (!app.tabs || app.tabs.current === 'build'),
        onDrop: (id, position) => change((d) => B.moveDevice(d, id, position)),
      });
    }).catch((error) => console.warn('[éditeur] déplacement indisponible', error.message || error));
  }

  paint();
  return {
    get active() { return !!history; },
    get draft() { return draft(); },
    /** Câble utilisé par les prochains branchements (outil « Relier », bouton « Câbler » en VR). */
    get cable() { return cable; },
    /** Choisit ce câble (étagère-catalogue du laboratoire, par exemple). */
    setCable(id) { if (CABLES[id]) { cable = id; paint(); } },
    start, quit, change,
  };
}

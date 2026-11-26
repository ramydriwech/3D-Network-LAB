// Panneau d'infos : nom, adresses IP et MAC de l'équipement sélectionné.
// À partir de la S3, il affiche aussi les tables vivantes (cache ARP, table MAC, table de
// routage…) et propose de lancer un ping entre les deux derniers hôtes sélectionnés.

import { Topics } from '../sim/events.js';
import { el, panelTitle } from './dom.js';
import { applyI18n, localize, onLangChange, registerStrings, t } from './i18n.js';
import { datasheetSection } from './datasheet.js';
import { hasConsole } from './terminal.js';

registerStrings({
  fr: {
    'info.title': 'Équipement',
    'info.hint': 'Cliquez (ou touchez) un équipement dans la scène pour afficher ses adresses.',
    'info.type.host': 'PC', 'info.type.server': 'Serveur', 'info.type.switch': 'Switch', 'info.type.router': 'Routeur', 'info.type.firewall': 'Pare-feu',
    'info.iface': 'Interface', 'info.ip': 'Adresse IP', 'info.mac': 'Adresse MAC',
    'info.noip': 'non configurée', 'info.gateway': 'Passerelle', 'info.dns': 'Serveur DNS',
    'info.ports': 'Ports', 'info.switch': 'Un switch travaille avec les adresses MAC : il n\'a pas d\'adresse IP.',
    'info.empty': 'vide',
    'info.ping': 'Lancer un ping {from} → {to}',
    'info.ping.hint': 'Astuce : sélectionnez un premier hôte puis un second pour lancer un ping entre eux.',
  },
  en: {
    'info.title': 'Device',
    'info.hint': 'Click (or tap) a device in the scene to display its addresses.',
    'info.type.host': 'PC', 'info.type.server': 'Server', 'info.type.switch': 'Switch', 'info.type.router': 'Router', 'info.type.firewall': 'Firewall',
    'info.iface': 'Interface', 'info.ip': 'IP address', 'info.mac': 'MAC address',
    'info.noip': 'not configured', 'info.gateway': 'Gateway', 'info.dns': 'DNS server',
    'info.ports': 'Ports', 'info.switch': 'A switch works with MAC addresses: it has no IP address.',
    'info.empty': 'empty',
    'info.ping': 'Start a ping {from} → {to}',
    'info.ping.hint': 'Tip: select a first host and then a second one to start a ping between them.',
  },
});

function table(columns, rows) {
  return el('table', { class: 'data' },
    el('thead', {}, el('tr', {}, columns.map((column) => el('th', {}, localize(column))))),
    el('tbody', {}, rows.length
      ? rows.map((row) => el('tr', {}, row.map((cell) => el('td', {}, localize(cell)))))
      : el('tr', {}, el('td', { colspan: columns.length, class: 'muted' }, t('info.empty')))));
}

export function initInfoPanel(app, slot = document.getElementById('info')) {
  const { sim } = app;
  let selected = null; // identifiant de l'équipement affiché
  let previous = null;

  function render() {
    const device = selected && sim.device(selected);
    if (!device) {
      slot.replaceChildren(panelTitle('info.title'), el('p', { class: 'muted', 'data-i18n': 'info.hint' }));
      applyI18n(slot);
      return;
    }
    const children = [
      el('h2', { class: 'panel-title' }, device.name, ' ', el('span', { class: `tag tag-${device.type}` }, t('info.type.' + device.type))),
    ];
    // Console de l'équipement (laboratoire de Steve) : un clic ouvre son terminal.
    const def = sim.scenario && sim.scenario.devices.find((d) => d.id === device.id);
    if (app.terminals && hasConsole(def)) {
      children.push(el('button', { type: 'button', class: 'btn btn-wide term-open', id: 'console-button', onclick: () => app.terminals.open(device.id) }, '>_ ', t('term.open')));
    }
    if (device.type === 'switch') {
      children.push(el('p', { class: 'muted' }, t('info.switch')));
      children.push(el('p', {}, el('strong', {}, t('info.ports') + ' : '), device.interfaces.map((iface) => iface.name).join(', ')));
    } else {
      children.push(table(
        [t('info.iface'), t('info.ip'), t('info.mac')],
        device.interfaces.map((iface) => [iface.name, iface.ip ? `${iface.ip}/${iface.prefix}` : t('info.noip'), iface.mac]),
      ));
      const facts = [];
      if (device.gateway) facts.push(el('li', {}, el('strong', {}, t('info.gateway') + ' : '), device.gateway));
      if (device.dnsServer) facts.push(el('li', {}, el('strong', {}, t('info.dns') + ' : '), device.dnsServer));
      if (facts.length) children.push(el('ul', { class: 'facts' }, facts));
    }

    // Tables vivantes : celles de l'équipement, puis celles que les protocoles exposent.
    const tables = [...device.tables()];
    for (const protocol of sim.registry.all()) {
      const extra = protocol.table ? protocol.table(device) : null;
      if (extra && extra.rows.length) tables.push(extra);
    }
    for (const item of tables) {
      children.push(el('h3', { class: 'sub-title' }, localize(item.title)));
      children.push(table(item.columns, item.rows));
    }

    // Ping entre les deux derniers hôtes sélectionnés (si le scénario a chargé ICMP).
    const source = previous && sim.device(previous);
    const canPing = sim.registry.has('icmp') && source && source !== device
      && typeof source.sendIp === 'function' && typeof device.sendIp === 'function'
      && source.interfaces.some((iface) => iface.ip) && device.interfaces.some((iface) => iface.ip);
    if (canPing) {
      children.push(el('button', {
        type: 'button', class: 'btn btn-primary btn-wide', id: 'ping-button',
        onclick: () => sim.runAction({ action: 'ping', from: source.id, to: device.id }),
      }, t('info.ping', { from: source.name, to: device.name })));
    } else if (sim.registry.has('icmp') && typeof device.sendIp === 'function') {
      children.push(el('p', { class: 'muted small' }, t('info.ping.hint')));
    }
    children.push(...datasheetSection(sim, device));
    slot.replaceChildren(...children);
  }

  sim.on(Topics.SELECT, (event) => {
    if (event.kind === 'device') { selected = event.id; previous = event.previous || null; }
    else if (event.kind === null) { selected = null; previous = null; }
    else return;
    render();
  });
  sim.on(Topics.DEVICE_UPDATE, (event) => { if (event.device === selected) render(); });
  sim.on(Topics.RESET, render);
  onLangChange(render);
  render();
}

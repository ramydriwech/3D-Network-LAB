// Missions du laboratoire (S7) : des exercices guidés pour Steve, dans l'esprit des
// simulateurs de réseau : une situation de départ (souvent en panne), des objectifs
// vérifiés automatiquement, des indices progressifs et un « Pourquoi ? » qui explique.
//
// Chaque objectif se vérifie sur ce que Steve a réellement fait, quelle que soit la façon :
//   - la CONFIGURATION (le scénario modifié par la console ou par l'éditeur),
//   - les COMMANDES tapées dans une console (historique),
//   - les ÉCHANGES réussis dans la simulation (un ping qui revient, une page reçue).
// Ce fichier ne dépend ni du rendu ni de l'interface : il est testé dans tests/missions.test.js.

import { diagnose } from './diagnostic.js';
import { evaluateAcl } from './security.js';
import { inNetwork } from './addr.js';
import { emptyDraft } from './builder.js';

/** Les deux adresses sont-elles dans le même réseau (celui de `ip`/`prefix`) ? */
const inSubnet = (other, ip, prefix) => inNetwork(other, ip, prefix);

const dev = (scenario, id) => (scenario && scenario.devices.find((d) => d.id === id)) || null;
const typed = (ctx, id, pattern) => ctx.history(id).some((line) => pattern.test(line.trim()));
const ACCEPTS_HTTP_TO = (rules, ip) => evaluateAcl(rules, { ip: { proto: 'TCP', src: '198.51.100.66', dst: ip }, tcp: { dstPort: 80 } }).permit;
const ACCEPTS_PING_TO = (rules, ip) => evaluateAcl(rules, { ip: { proto: 'ICMP', src: '198.51.100.66', dst: ip }, icmp: { type: 8 } }).permit;

/** ACL entrante de l'interface « outside » du pare-feu (ou null). */
function outsideAcl(fw) {
  const outside = fw && (fw.interfaces || []).find((i) => i.zone === 'outside' || i.nat === 'outside');
  const name = outside && outside.acl && outside.acl.in;
  return name && fw.acls && fw.acls[name] ? fw.acls[name] : null;
}

export const MISSIONS = Object.freeze([
  {
    id: 'prise-en-main',
    level: 1,
    base: 'routage.json',
    title: { fr: 'Prise en main : interroger un routeur', en: 'Getting started: query a router' },
    brief: {
      fr: 'Deux routeurs relient deux réseaux. Ouvrez la console de R1, passez en mode privilégié et affichez sa table de routage, puis vérifiez depuis PC1 que PC2 répond.',
      en: 'Two routers connect two networks. Open R1\'s console, enter privileged mode and display its routing table, then check from PC1 that PC2 answers.',
    },
    tasks: [
      { text: { fr: 'Sur R1 : passer en mode privilégié (enable)', en: 'On R1: enter privileged mode (enable)' }, check: (ctx) => typed(ctx, 'r1', /^en(a(b(le?)?)?)?$/i) },
      { text: { fr: 'Sur R1 : afficher la table de routage', en: 'On R1: display the routing table' }, check: (ctx) => typed(ctx, 'r1', /^(do\s+)?sh(o(w)?)?\s+ip\s+ro/i) },
      { text: { fr: 'Depuis PC1 : réussir un ping vers PC2 (10.0.2.10)', en: 'From PC1: ping PC2 successfully (10.0.2.10)' }, check: (ctx) => ctx.pinged('pc1', '10.0.2.10') },
    ],
    hints: [
      { fr: 'Visez R1 et appuyez sur E (ou bouton « Ouvrir la console »). L\'invite R1> devient R1# après « enable ».', en: 'Aim at R1 and press E (or the "Open the console" button). The R1> prompt becomes R1# after "enable".' },
      { fr: 'La commande est « show ip route » ; « sh ip ro » suffit, comme sur le vrai matériel.', en: 'The command is "show ip route"; "sh ip ro" is enough, as on real gear.' },
      { fr: 'Dans la console de PC1, tapez « ping 10.0.2.10 ».', en: 'In PC1\'s console, type "ping 10.0.2.10".' },
    ],
    why: {
      fr: 'La table de routage dit au routeur par où envoyer chaque paquet. R1 connaît ses deux réseaux directement connectés (C) et une route statique (S) vers 10.0.2.0/24 via R2. Sans elle, il jetterait les paquets pour PC2.',
      en: 'The routing table tells the router where to send each packet. R1 knows its two directly connected networks (C) and one static route (S) to 10.0.2.0/24 via R2. Without it, it would drop packets for PC2.',
    },
  },
  {
    id: 'route-manquante',
    level: 2,
    base: 'routage.json',
    prepare(scenario) {
      const next = structuredClone(scenario);
      dev(next, 'r2').routes = [];
      next.steps = [];
      return next;
    },
    title: { fr: 'Panne : la route de retour a disparu', en: 'Outage: the return route is gone' },
    brief: {
      fr: 'Depuis ce matin, PC1 ne joint plus PC2. Le ping part bien mais aucune réponse ne revient. Trouvez le routeur fautif et réparez-le avec une route statique.',
      en: 'Since this morning, PC1 cannot reach PC2. The ping leaves but no reply comes back. Find the faulty router and fix it with a static route.',
    },
    tasks: [
      { text: { fr: 'R2 sait à nouveau joindre 10.0.1.0/24 (via 10.0.12.1)', en: 'R2 can reach 10.0.1.0/24 again (via 10.0.12.1)' },
        check: (ctx) => (dev(ctx.scenario, 'r2').routes || []).some((r) => r.network === '10.0.1.0' && r.prefix === 24 && r.via === '10.0.12.1') },
      { text: { fr: 'Prouver la réparation : ping de PC1 vers PC2 réussi', en: 'Prove the fix: successful ping from PC1 to PC2' }, check: (ctx) => ctx.pinged('pc1', '10.0.2.10') },
    ],
    hints: [
      { fr: 'Un paquet doit aussi pouvoir REVENIR. Comparez « show ip route » sur R1 et sur R2.', en: 'A packet must also be able to COME BACK. Compare "show ip route" on R1 and on R2.' },
      { fr: 'Sur R2 : enable, configure terminal, puis une commande « ip route réseau masque passerelle ».', en: 'On R2: enable, configure terminal, then an "ip route network mask next-hop" command.' },
      { fr: 'ip route 10.0.1.0 255.255.255.0 10.0.12.1', en: 'ip route 10.0.1.0 255.255.255.0 10.0.12.1' },
    ],
    why: {
      fr: 'Le routage est décidé saut par saut et dans chaque sens. R1 savait aller vers 10.0.2.0/24, mais R2 ne savait plus renvoyer la réponse vers 10.0.1.0/24 : il la jetait (« destination injoignable »). Un aller qui fonctionne ne garantit jamais le retour.',
      en: 'Routing is decided hop by hop and in each direction. R1 knew how to reach 10.0.2.0/24, but R2 no longer knew how to send the reply back to 10.0.1.0/24: it dropped it ("destination unreachable"). A working forward path never guarantees the way back.',
    },
  },
  {
    id: 'vlan-errone',
    level: 2,
    base: 'vlan.json',
    prepare(scenario) {
      const next = structuredClone(scenario);
      dev(next, 'sw1').ports.p3 = { vlan: 10 };
      next.steps = [];
      return next;
    },
    title: { fr: 'VLAN : un poste dans le mauvais service', en: 'VLAN: a computer in the wrong department' },
    brief: {
      fr: 'PC3 (service Étudiants, 192.168.20.13) n\'atteint plus sa passerelle. Un collègue a modifié le switch SW1 hier. Remettez le port de PC3 dans le bon VLAN.',
      en: 'PC3 (Students, 192.168.20.13) can no longer reach its gateway. A colleague changed switch SW1 yesterday. Put PC3\'s port back in the right VLAN.',
    },
    tasks: [
      { text: { fr: 'Le port de PC3 (Gi0/3) est dans le VLAN 20', en: 'PC3\'s port (Gi0/3) is in VLAN 20' }, check: (ctx) => ((dev(ctx.scenario, 'sw1').ports || {}).p3 || {}).vlan === 20 },
      { text: { fr: 'PC3 joint sa passerelle 192.168.20.1 (ping)', en: 'PC3 reaches its gateway 192.168.20.1 (ping)' }, check: (ctx) => ctx.pinged('pc3', '192.168.20.1') },
    ],
    hints: [
      { fr: 'Sur SW1 : « show vlan brief » montre quel port est dans quel VLAN.', en: 'On SW1: "show vlan brief" shows which port is in which VLAN.' },
      { fr: 'interface gi0/3 puis « switchport access vlan … ».', en: 'interface gi0/3 then "switchport access vlan …".' },
      { fr: 'configure terminal · interface gi0/3 · switchport access vlan 20', en: 'configure terminal · interface gi0/3 · switchport access vlan 20' },
    ],
    why: {
      fr: 'Un VLAN est un switch « virtuel » : les trames du VLAN 10 ne sortent jamais sur un port du VLAN 20. PC3 était adressé pour le réseau 192.168.20.0/24 mais branché dans le VLAN 10 : sa demande ARP pour 192.168.20.1 n\'arrivait jamais à la sous-interface g0/0.20 du routeur.',
      en: 'A VLAN is a "virtual" switch: VLAN 10 frames never leave on a VLAN 20 port. PC3 was addressed for 192.168.20.0/24 but plugged into VLAN 10: its ARP request for 192.168.20.1 never reached the router\'s g0/0.20 sub-interface.',
    },
  },
  {
    id: 'port-securise',
    level: 3,
    base: 'securite-port.json',
    prepare(scenario) {
      const next = structuredClone(scenario);
      delete dev(next, 'sw1').ports.p1;
      next.steps = [];
      return next;
    },
    title: { fr: 'Verrouiller la prise du bureau', en: 'Lock the office socket' },
    brief: {
      fr: 'N\'importe qui peut brancher un portable à la place de PC1 sur le port Gi0/1 de SW1. Activez la sécurité de port : une seule adresse MAC, apprise automatiquement, et le port se coupe en cas d\'intrusion.',
      en: 'Anyone can plug a laptop into SW1\'s Gi0/1 port instead of PC1. Enable port security: one MAC address, learnt automatically, and the port shuts down on intrusion.',
    },
    tasks: [
      { text: { fr: 'Sécurité de port activée sur Gi0/1, 1 adresse au maximum', en: 'Port security on Gi0/1, at most 1 address' }, check: (ctx) => { const sec = ((dev(ctx.scenario, 'sw1').ports || {}).p1 || {}).security; return !!sec && sec.maximum === 1; } },
      { text: { fr: 'Adresse apprise automatiquement (sticky)', en: 'Address learnt automatically (sticky)' }, check: (ctx) => { const sec = ((dev(ctx.scenario, 'sw1').ports || {}).p1 || {}).security; return !!sec && sec.sticky === true; } },
      { text: { fr: 'Réaction en cas de violation : couper le port (shutdown)', en: 'Violation action: shut the port down' }, check: (ctx) => { const sec = ((dev(ctx.scenario, 'sw1').ports || {}).p1 || {}).security; return !!sec && (sec.violation || 'shutdown') === 'shutdown'; } },
    ],
    hints: [
      { fr: 'Ces commandes se tapent dans l\'interface : interface gi0/1.', en: 'These commands go inside the interface: interface gi0/1.' },
      { fr: 'switchport port-security, puis « maximum », « mac-address sticky » et « violation ».', en: 'switchport port-security, then "maximum", "mac-address sticky" and "violation".' },
      { fr: 'switchport port-security · switchport port-security maximum 1 · switchport port-security mac-address sticky · switchport port-security violation shutdown', en: 'switchport port-security · switchport port-security maximum 1 · switchport port-security mac-address sticky · switchport port-security violation shutdown' },
    ],
    why: {
      fr: 'La sécurité de port limite les adresses MAC qu\'un port accepte. « sticky » retient la première adresse vue (celle de PC1) dans la configuration ; toute autre machine déclenche une violation et le port passe en « err-disabled » : le câble devient rouge foncé dans la scène.',
      en: 'Port security limits the MAC addresses a port accepts. "sticky" keeps the first address seen (PC1\'s) in the configuration; any other machine triggers a violation and the port goes "err-disabled": the cable turns dark red in the scene.',
    },
  },
  {
    id: 'ouvrir-le-web',
    level: 3,
    base: 'pare-feu.json',
    prepare(scenario) {
      const next = structuredClone(scenario);
      dev(next, 'fw1').acls['DEPUIS-INTERNET'] = [];
      next.steps = [];
      return next;
    },
    title: { fr: 'Pare-feu : publier le site web, rien de plus', en: 'Firewall: publish the website, nothing more' },
    brief: {
      fr: 'Le serveur WEB1 de la DMZ doit être joignable depuis Internet en HTTP (port 80), via l\'adresse publique 203.0.113.5. Tout le reste doit rester bloqué : n\'ouvrez que le strict nécessaire.',
      en: 'Server WEB1 in the DMZ must be reachable from the Internet over HTTP (port 80), via public address 203.0.113.5. Everything else must stay blocked: open only what is needed.',
    },
    tasks: [
      { text: { fr: 'L\'ACL entrante côté Internet autorise TCP 80 vers 172.16.1.80', en: 'The Internet-side inbound ACL allows TCP 80 to 172.16.1.80' },
        check: (ctx) => { const rules = outsideAcl(dev(ctx.scenario, 'fw1')); return !!rules && ACCEPTS_HTTP_TO(rules, '172.16.1.80'); } },
      { text: { fr: 'Le ping depuis Internet reste interdit', en: 'Pings from the Internet stay forbidden' },
        check: (ctx) => { const rules = outsideAcl(dev(ctx.scenario, 'fw1')); return !!rules && ACCEPTS_HTTP_TO(rules, '172.16.1.80') && !ACCEPTS_PING_TO(rules, '172.16.1.80') && !ACCEPTS_HTTP_TO(rules, '192.168.1.10'); } },
    ],
    hints: [
      { fr: 'Sur FW1 : « show access-lists » et « show running-config » montrent la liste DEPUIS-INTERNET, appliquée en entrée sur Gi0/1.', en: 'On FW1: "show access-lists" and "show running-config" show the DEPUIS-INTERNET list, applied inbound on Gi0/1.' },
      { fr: 'Les règles se placent dans « ip access-list extended DEPUIS-INTERNET ». Après NAT, la destination est l\'adresse privée du serveur.', en: 'Rules go into "ip access-list extended DEPUIS-INTERNET". After NAT, the destination is the server\'s private address.' },
      { fr: 'permit tcp any host 172.16.1.80 eq 80', en: 'permit tcp any host 172.16.1.80 eq 80' },
    ],
    why: {
      fr: 'Un pare-feu à états laisse revenir les réponses aux connexions ouvertes de l\'intérieur, mais refuse ce qui arrive d\'Internet sauf règle explicite. Le NAT statique traduit d\'abord 203.0.113.5 en 172.16.1.80, puis l\'ACL décide. Une règle « permit ip any any » marcherait aussi… en ouvrant tout le réseau : c\'est le principe du moindre privilège.',
      en: 'A stateful firewall lets replies to connections opened from inside come back, but refuses what arrives from the Internet unless a rule allows it. Static NAT first translates 203.0.113.5 into 172.16.1.80, then the ACL decides. A "permit ip any any" rule would also work… by opening the whole network: this is the principle of least privilege.',
    },
  },
  {
    id: 'mon-reseau',
    level: 4,
    base: null, // réseau vide : tout est à construire
    title: { fr: 'Votre réseau, de zéro', en: 'Your own network, from scratch' },
    brief: {
      fr: 'Le labo est vide. Prenez sur l\'étagère deux PC, un switch et un routeur (les modèles de votre choix), câblez-les pour former deux réseaux, adressez-les et prouvez que les deux PC se joignent.',
      en: 'The lab is empty. Take two PCs, a switch and a router from the shelf (any models), cable them into two networks, address them and prove both PCs reach each other.',
    },
    tasks: [
      { text: { fr: 'Au moins 2 PC et 1 routeur dans le labo', en: 'At least 2 PCs and 1 router in the lab' },
        check: (ctx) => ctx.scenario.devices.filter((d) => d.type === 'host').length >= 2 && ctx.scenario.devices.some((d) => d.type === 'router' || d.type === 'firewall') },
      { text: { fr: 'Tous les équipements sont câblés', en: 'Every device is cabled' },
        check: (ctx) => ctx.scenario.devices.length > 1 && ctx.scenario.devices.every((d) => ctx.scenario.links.some((l) => l.a.startsWith(`${d.id}:`) || l.b.startsWith(`${d.id}:`))) },
      { text: { fr: 'Deux PC dans deux réseaux IP différents, chacun avec sa passerelle', en: 'Two PCs in two different IP networks, each with a gateway' },
        check: (ctx) => {
          const hosts = ctx.scenario.devices.filter((d) => d.type === 'host' && d.gateway && (d.interfaces || []).some((i) => i.ip));
          return hosts.some((a) => hosts.some((b) => { const ia = a.interfaces.find((i) => i.ip); const ib = b.interfaces.find((i) => i.ip); return a !== b && !inSubnet(ib.ip, ia.ip, ia.prefix); }));
        } },
      { text: { fr: 'Le diagnostic ne signale aucune erreur', en: 'The diagnostic reports no error' }, check: (ctx) => ctx.scenario.devices.length > 2 && diagnose(ctx.scenario).counts.error === 0 },
      { text: { fr: 'Un ping entre deux PC de réseaux différents réussit', en: 'A ping between two PCs on different networks succeeds' },
        check: (ctx) => {
          const hosts = ctx.scenario.devices.filter((d) => d.type === 'host');
          return hosts.some((a) => hosts.some((b) => {
            const ia = (a.interfaces || []).find((i) => i.ip); const ib = (b.interfaces || []).find((i) => i.ip);
            return a !== b && ia && ib && !inSubnet(ib.ip, ia.ip, ia.prefix) && ctx.pinged(a.id, ib.ip);
          }));
        } },
    ],
    hints: [
      { fr: 'Visez l\'étagère « Catalogue » et cliquez un modèle : il apparaît devant vous. L\'onglet Construire (touche B) sert à câbler avec l\'outil « Relier ».', en: 'Aim at the "Catalogue" shelf and click a model: it appears in front of you. The Build tab (B key) connects devices with the "Connect" tool.' },
      { fr: 'Exemple : PC1 — SW1 — R1 — PC2. Le routeur a une interface dans chaque réseau ; chaque PC a pour passerelle l\'adresse du routeur de son côté.', en: 'Example: PC1 — SW1 — R1 — PC2. The router has one interface in each network; each PC uses its side\'s router address as gateway.' },
      { fr: 'Sur R1 : interface g0/0 · ip address 192.168.1.1 255.255.255.0 · interface g0/1 · ip address 192.168.2.1 255.255.255.0. Sur PC1 : netsh interface ip set address "eth0" static 192.168.1.10 255.255.255.0 192.168.1.1', en: 'On R1: interface g0/0 · ip address 192.168.1.1 255.255.255.0 · interface g0/1 · ip address 192.168.2.1 255.255.255.0. On PC1: netsh interface ip set address "eth0" static 192.168.1.10 255.255.255.0 192.168.1.1' },
    ],
    why: {
      fr: 'Le switch relie les machines d\'un même réseau (niveau 2, adresses MAC) ; le routeur relie des réseaux différents (niveau 3, adresses IP). Un PC envoie tout ce qui sort de son réseau à sa passerelle : sans elle, il ne sait joindre que ses voisins directs.',
      en: 'The switch connects machines of the same network (layer 2, MAC addresses); the router connects different networks (layer 3, IP addresses). A PC sends everything leaving its network to its gateway: without one, it can only reach its direct neighbours.',
    },
  },
]);

/** Scénario de départ d'une mission (`load` : fichier → scénario, pour les missions sur base). */
export async function missionScenario(mission, load) {
  const base = mission.base ? await load(mission.base) : emptyDraft();
  const prepared = mission.prepare ? mission.prepare(base) : structuredClone(base);
  return { ...prepared, id: `mission-${mission.id}`, title: mission.title, summary: mission.brief };
}

/**
 * Évalue une mission. `ctx` : { scenario, history(id) → [lignes], pinged(fromId, ip) → bool }.
 * @returns {{ done: boolean[], complete: boolean, score: number }}
 */
export function evaluateMission(mission, ctx) {
  const done = mission.tasks.map((task) => {
    try { return !!task.check(ctx); } catch { return false; }
  });
  const count = done.filter(Boolean).length;
  return { done, complete: count === done.length, score: count };
}

/**
 * Suit les pings réussis dans la simulation : un « Echo Reply » accepté par `device`,
 * venant de l'adresse `ip`. `reset()` oublie tout (début d'une mission).
 */
export function createPingTracker(sim, Topics) {
  const seen = new Set();
  const off = sim.on(Topics.PACKET_RECEIVE, (event) => {
    const packet = event.packet;
    if (event.accepted && packet && packet.icmp && packet.icmp.type === 0 && packet.ip) seen.add(`${event.device}|${packet.ip.src}`);
  });
  return {
    pinged: (from, ip) => seen.has(`${from}|${ip}`),
    reset: () => seen.clear(),
    dispose: off,
  };
}

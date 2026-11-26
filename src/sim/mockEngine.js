// Faux moteur (mock) : il a la même interface que la vraie simulation (simulation.js)
// mais rejoue simplement une liste d'évènements écrite à la main. Il permet de développer
// et de tester l'interface ou le rendu 3D sans attendre le vrai moteur.
//
//   const sim = createMockSimulation();
//   sim.on('packet:send', (event) => console.log(event.packet.label));
//   sim.execute('play'); sim.tick(1500);

import { Topics, HOP_DURATION, note } from './events.js';

const STATES = { READY: 'ready', PLAYING: 'playing', PAUSED: 'paused', FINISHED: 'finished' };

const request = {
  id: 'm1', flow: 'm1', protocol: 'arp', label: 'ARP Request', cast: 'broadcast',
  eth: { src: '02:00:00:00:01:10', dst: 'FF:FF:FF:FF:FF:FF', type: 'ARP' },
  arp: { op: 'request', senderMac: '02:00:00:00:01:10', senderIp: '192.168.1.10', targetMac: '00:00:00:00:00:00', targetIp: '192.168.1.11' },
  explain: note('mock.request'),
};
const reply = {
  id: 'm2', flow: 'm2', protocol: 'arp', label: 'ARP Reply', cast: 'unicast',
  eth: { src: '02:00:00:00:01:11', dst: '02:00:00:00:01:10', type: 'ARP' },
  arp: { op: 'reply', senderMac: '02:00:00:00:01:11', senderIp: '192.168.1.11', targetMac: '02:00:00:00:01:10', targetIp: '192.168.1.10' },
  explain: note('mock.reply'),
};

/** Script par défaut, valable sur scenarios/topologie-demo.json (PC1 — SW1 — PC2). */
export const DEFAULT_SCRIPT = [
  { at: 200, topic: Topics.PACKET_SEND, payload: { packet: request, from: 'pc1', to: 'sw1', linkId: 'l1', duration: HOP_DURATION, notes: [request.explain] } },
  { at: 1200, topic: Topics.PACKET_RECEIVE, payload: { packet: request, device: 'sw1', from: 'pc1', linkId: 'l1', accepted: true, notes: [] } },
  { at: 1400, topic: Topics.PACKET_SEND, payload: { packet: request, from: 'sw1', to: 'pc2', linkId: 'l2', duration: HOP_DURATION, notes: [request.explain] } },
  { at: 2400, topic: Topics.PACKET_RECEIVE, payload: { packet: request, device: 'pc2', from: 'sw1', linkId: 'l2', accepted: true, notes: [] } },
  { at: 2600, topic: Topics.PACKET_SEND, payload: { packet: reply, from: 'pc2', to: 'sw1', linkId: 'l2', duration: HOP_DURATION, notes: [reply.explain] } },
  { at: 3600, topic: Topics.PACKET_RECEIVE, payload: { packet: reply, device: 'sw1', from: 'pc2', linkId: 'l2', accepted: true, notes: [] } },
  { at: 3800, topic: Topics.PACKET_SEND, payload: { packet: reply, from: 'sw1', to: 'pc1', linkId: 'l1', duration: HOP_DURATION, notes: [reply.explain] } },
  { at: 4800, topic: Topics.PACKET_RECEIVE, payload: { packet: reply, device: 'pc1', from: 'sw1', linkId: 'l1', accepted: true, notes: [] } },
];

const MOCK_TEXTS = {
  'mock.request': { fr: '(mock) PC1 demande l\'adresse MAC de 192.168.1.11.', en: '(mock) PC1 asks for the MAC address of 192.168.1.11.' },
  'mock.reply': { fr: '(mock) PC2 répond avec son adresse MAC.', en: '(mock) PC2 replies with its MAC address.' },
};

export function createMockSimulation(script = DEFAULT_SCRIPT) {
  const listeners = new Map();
  const emit = (topic, payload = {}) => {
    for (const listener of listeners.get(topic) || []) listener(payload, topic);
  };
  let state = STATES.READY;
  let now = 0;
  let speed = 1;
  let cursor = 0;
  let stepping = false;

  const setState = (next) => {
    const previous = state;
    state = next;
    if (previous !== next) emit(Topics.STATE, { state: next, previous });
  };

  const available = {
    play: () => state === STATES.READY || state === STATES.PAUSED,
    pause: () => state === STATES.PLAYING,
    step: () => state === STATES.READY || state === STATES.PAUSED,
    speed: () => true,
    reset: () => true,
  };

  function advance(simDt) {
    const target = now + simDt;
    while (state === STATES.PLAYING && cursor < script.length && script[cursor].at <= target) {
      const entry = script[cursor++];
      now = entry.at;
      emit(entry.topic, { ...entry.payload, time: now });
      if (stepping && entry.topic === Topics.PACKET_RECEIVE) {
        stepping = false;
        setState(cursor >= script.length ? STATES.FINISHED : STATES.PAUSED);
      }
    }
    if (state === STATES.PLAYING) {
      now = Math.min(target, cursor >= script.length ? now : target);
      if (cursor >= script.length) {
        setState(STATES.FINISHED);
        emit(Topics.FINISHED, { now });
      }
    }
    emit(Topics.CLOCK, { now });
  }

  const on = (topic, listener) => {
    if (!listeners.has(topic)) listeners.set(topic, new Set());
    listeners.get(topic).add(listener);
    return () => listeners.get(topic).delete(listener);
  };

  const sim = {
    isMock: true,
    bus: { on, emit },
    scenario: null,
    network: null,
    get state() { return state; },
    get now() { return now; },
    get speed() { return speed; },
    on,
    can(name) { return !!available[name] && available[name](); },
    execute(name, argument) {
      if (!sim.can(name)) return false;
      if (name === 'play') { stepping = false; setState(STATES.PLAYING); }
      if (name === 'pause') setState(STATES.PAUSED);
      if (name === 'step') { stepping = true; setState(STATES.PLAYING); if (argument && argument.instant) advance(Infinity); }
      if (name === 'speed') { speed = Number(argument); emit(Topics.SPEED, { speed }); }
      if (name === 'reset') {
        now = 0; cursor = 0; stepping = false;
        setState(STATES.READY);
        emit(Topics.RESET, {});
        emit(Topics.CLOCK, { now: 0 });
      }
      return true;
    },
    tick(realDtMs) { if (state === STATES.PLAYING) advance(realDtMs * speed); },
    async loadScenario(scenario) {
      sim.scenario = scenario;
      sim.execute('reset');
      emit(Topics.SCENARIO_LOADED, { scenario });
      return scenario;
    },
    text(key) { return MOCK_TEXTS[key] || null; },
    device() { return null; },
    steps() { return []; },
  };
  return sim;
}

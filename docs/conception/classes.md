# Diagramme de classes

Le diagramme couvre la simulation (`simulation.js`, `src/sim/`), cœur métier de l'application. Le rendu et
l'interface n'ont pas de classes : ce sont des modules de fonctions abonnés au bus.

```mermaid
classDiagram
  direction LR

  class Simulation {
    <<façade>>
    +scenario
    +network : Network
    +state +now +speed
    +on(topic, listener)
    +execute(command, arg)
    +can(command) bool
    +tick(realDtMs)
    +loadScenario(scenario)
    +runAction(step)
    +device(id) Device
    +text(key)
  }

  class Engine {
    -queue : Event[]
    +now : number
    +speed : number
    +schedule(delay, run, boundary) id
    +cancel(id)
    +play() +pause() +step() +reset()
    +setSpeed(speed)
    +tick(realDtMs)
    +advance(simDt)
    +runToEnd()
  }

  class StateMachine {
    <<State>>
    +state : ready|playing|paused|finished
    +can(command) bool
    +to(next)
    +reset()
  }

  class EventBus {
    <<Observer>>
    +on(topic, listener) off
    +once(topic, listener)
    +emit(topic, payload)
  }

  class Command {
    <<Command>>
    +canExecute() bool
    +execute(arg)
  }
  class PlayCommand
  class PauseCommand
  class StepCommand
  class SpeedCommand
  class ResetCommand
  class ToggleCommand

  class ProtocolRegistry {
    <<Strategy — registre>>
    +load(ids)
    +register(protocol)
    +get(id) Protocol
    +actionOwner(action) Protocol
    +text(key)
  }

  class Protocol {
    <<interface — Strategy>>
    +id +name +layer
    +requires : string[]
    +actions : string[]
    +texts
    +install(device, net)
    +start(net, step)
    +describe(packet) rows
    +table(device)
  }

  class Network {
    +devices : Map
    +links : Map
    +packet(fields) Packet
    +clone(packet, overrides) Packet
    +transmit(device, iface, packet, notes)
    +drop(device, packet, notes)
    +info(device, notes)
    +update(device, what)
    +runAction(step)
  }

  class Device {
    +id +type +name
    +interfaces : Interface[]
    +receive(packet, iface) result
    +tables()
  }
  class IpNode {
    +gateway
    +arpCache : Map
    +on(key, handler)
    +routes()
    +lookup(dst) hop
    +sendIp(fields, notes)
    +output(hop, makePacket, notes)
  }
  class Host
  class Router {
    +staticRoutes
    +forward(packet, inIface)
  }
  class Switch {
    +macTable : Map
    +receive(packet, port)
  }

  class Packet {
    <<donnée>>
    +id +flow +protocol +label +cast
    +eth : src, dst, type
    +ip : src, dst, ttl, proto
    +arp | icmp | udp | tcp | dns | dhcp | http
  }

  Simulation *-- Engine
  Simulation *-- EventBus
  Simulation *-- ProtocolRegistry
  Simulation o-- Network : reconstruit à chaque reset
  Simulation *-- "6" Command
  Engine *-- StateMachine
  Engine --> EventBus : publie
  StateMachine --> EventBus : publie
  Command --> Engine : pilote
  Command <|-- PlayCommand
  Command <|-- PauseCommand
  Command <|-- StepCommand
  Command <|-- SpeedCommand
  Command <|-- ResetCommand
  Command <|-- ToggleCommand
  ProtocolRegistry o-- "0..*" Protocol
  Network *-- "1..*" Device
  Network --> Engine : programme les évènements
  Network --> EventBus : publie
  Network ..> Packet : crée
  Protocol ..> Device : install()
  Device <|-- IpNode
  Device <|-- Switch
  IpNode <|-- Host
  IpNode <|-- Router
```

Protocoles livrés (chacun réalise `Protocol`) : `arp`, `icmp`, `udp`, `dns`, `dhcp`, `tcp`, `http`, `ipv6`.

## Les cinq patrons de conception du cahier des charges

| Patron | Où | Pourquoi |
| --- | --- | --- |
| **Observer** | `EventBus` (`src/sim/eventBus.js`) | la simulation publie ; l'interface, la 3D et la VR s'abonnent. Aucune partie n'appelle directement une autre : chacune se développe et se teste seule. |
| **Command** | `src/sim/commands.js` | lecture, pause, pas à pas, vitesse, réinitialisation sont des objets `canExecute()` / `execute()`. Les boutons HTML, le clavier et le panneau VR partagent la même logique. |
| **Strategy** | `ProtocolRegistry` + un fichier par protocole | la logique de traitement est choisie d'après l'identifiant du protocole. Ajouter un protocole = ajouter un fichier, sans toucher au moteur. |
| **Factory** | `loadDeviceTypes()` (`src/sim/network.js`) et `createDeviceFactory()` (`src/render/factory.js`) | à partir de l'objet JSON d'un équipement, créer le bon comportement (hôte, routeur, switch) et le bon modèle 3D. |
| **State** | `StateMachine` (`src/sim/state.js`) | prêt, lecture, pause, terminé : les transitions interdites sont refusées et l'interface sait quels boutons activer. |

## Choix de conception

- **`Network` ne connaît aucun protocole.** Il transporte des trames d'un bout à l'autre d'un câble. Les protocoles
  se branchent sur les équipements (`device.on('ip:ICMP', fn)`), ce qui évite toute dépendance du moteur vers eux.
- **`IpNode` factorise** ce que l'hôte et le routeur ont en commun (table de routage, émission IP, cache ARP) ;
  le routeur n'ajoute que le relais (`forward`) et les routes statiques.
- **Le réseau est reconstruit à chaque réinitialisation** : tables et caches repartent vides, sans code de nettoyage à maintenir.
- **`Packet` est une simple donnée**, validée à la création (`createPacket`). Un paquet relayé est une copie (`clone`)
  qui garde le même `flow` : on peut suivre un message de saut en saut.

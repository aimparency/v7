# KI4KMU — Projektskizze (Draft)

**Status:** Draft for 15 October 2026 submission window.  
**Target grant:** ~€50,000 (75% startup rate on ~€67k project)  
**Duration:** 24 months (max per BMBF program)

---

## Kurzbeschreibung (Executive Summary)

Aimparency entwickelt ein KI-gestütztes System zur **expliziten Modellierung menschlicher und agentischer Ziele** als Graph. Nutzer und autonome Agenten kooperieren an einem transparenten Willensmodell — inspectierbar, versioniert, priorisierbar. Das Projekt adressiert den Mangel an Nachvollziehbarkeit und strategischer Steuerung in autonomen KI-Systemen.

**Förderkategorie:** Innovative nutzerorientierte Dienstleistungen / Daten- und IKT-Wirtschaft  
**KI-Schwerpunkt:** Digitale Assistenten, Grundfragen zu intelligenten Systemen

---

## 1. Antragsteller

| | |
|---|---|
| Unternehmen | [Aimparency GmbH/UG — nach Gründung] |
| Gründung | < 3 Jahre (Startup-Fördersatz 75%) |
| Standort | Berlin |
| Team | Felix Niemeyer (Tech), Robin Maier (Business) |

---

## 2. Problem & Motivation

Menschen haben Ideen, aber nicht immer Zeit, Mittel oder Fähigkeiten zur Umsetzung. KI-Coding-Assistenten zeigen, dass KI die Lücke zwischen Vision und Ausführung schließen kann — jedoch nur in engen Domänen und ohne strategische Zielmodellierung.

Autonome Agenten werden leistungsfähiger, aber ihre **Absichten bleiben undurchsichtig**. Nutzer können Prioritäten nicht prüfen, Widersprüche nicht auflösen und langfristige Strategie nicht mitgestalten.

---

## 3. Forschungs- und Entwicklungsziele

### WP1: Zielgraph-Engine mit KI-gestützter Priorisierung
- Semantische Suche über Ziele (Embeddings)
- Wert-/Kosten-Fluss für automatische Priorisierung
- Zyklus- und Konsistenzprüfung

### WP2: Agentische Ausführungsschicht
- MCP-Integration für externe Werkzeuge
- Discover→Plan→Execute→Verify→Submit Loop
- Watchdog-Supervision über Sessions

### WP3: Mensch-KI-Kooperations-Interface
- Graph-UI zur Inspektion und Bearbeitung
- Konversations- und Voice-Interface zur Ziel-Extraktion
- Human-in-the-Loop bei kritischen Entscheidungen

### WP4: Evaluation & Pilot
- 3–5 Pilotnutzer (technische Gründer, KMU)
- Metriken: Zielerreichungsrate, Zeitersparnis, Nutzer-Souveränität (Umfrage)
- Open-Source-Release des Graph-Formats

---

## 4. Innovationsgehalt

| Aspekt | Stand der Technik | Aimparency |
|--------|-------------------|------------|
| Zielrepräsentation | Task lists, hidden chains | Expliziter Zielgraph mit Wertfluss |
| Persistenz | Cloud-proprietär | Git-native, lokal-first |
| Mensch-KI-Verhältnis | Prompt → Output | Kooperative Willensmodellierung |
| Auditierbarkeit | Logs | Versionierte Zielhistorie + Reflections |

**Nicht geförderte Bereiche (bewusst vermieden):** HR, Marketing-only, IT-Sicherheit-only, Predictive Maintenance.

---

## 5. Verwertungsperspektive

- B2B SaaS für technische Teams und Gründer
- Open-Source-Kern für Community-Adoption
- Langfristig: Infrastrukturschicht für Agentic-AI-Ökosystem in Europa

**Wettbewerb:** Manus, OpenAI Operator, Claude Projects — differenziert durch strategische Zielmodellierung und physische Projekt-Unterstützung (Roadmap).

---

## 6. Kostenübersicht

| Position | EUR |
|----------|-----|
| Personal (Gründer R&D) | 45.000 |
| KI-API / Compute | 12.000 |
| Sachkosten (Software, Hardware) | 5.000 |
| Externe Dienstleistungen | 5.000 |
| **Summe** | **67.000** |
| **Förderung (75% Startup)** | **50.250** |
| **Eigenanteil** | **16.750** |

---

## 7. Zeitplan

| Phase | Monate | Deliverable |
|-------|--------|-------------|
| WP1 | 1–6 | Graph engine v2, semantic search |
| WP2 | 4–12 | Autonomous agent loop production-ready |
| WP3 | 8–18 | Voice + conversation MVP |
| WP4 | 15–24 | Pilot evaluation report |

**Einreichung Projektskizze:** 15. Oktober 2026  
**Projektbeginn:** Frühestens nach Bewilligung (Q1 2027 erwartet)

---

## 8. Bezug zu SDG

- **SDG 8:** Decent Work — Produktivitätssteigerung für Wissensarbeiter
- **SDG 9:** Industry & Innovation — resiliente KI-Infrastruktur
- **SDG 16.6:** Transparente, rechenschaftspflichtige Institutionen — technischer Standard für agentische Systeme

---

## 9. Checkliste vor Einreichung

- [ ] GmbH/UG gegründet (< 3 Jahre)
- [ ] Projektskizze über BMBF/easy-Online Portal
- [ ] Absprache mit Projektträger (VDI/VDE IT, PTJ — je nach aktueller Bekanntmachung)
- [ ] Keine Doppelfinanzierung mit ZIM/IBB für gleiche Kostenpositionen
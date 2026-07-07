# ZIM Einzelprojekt — Projektskizze (Draft)

**Status:** Draft for review. Submit after GmbH/UG incorporation via PTJ easy-Online.  
**Target grant:** ~€50,000 (60% of €83,333 project volume)  
**Duration:** 18 months

---

## 1. Antragstellendes Unternehmen

| Field | Value |
|-------|-------|
| Name | [Aimparency GmbH / UG — TBD at incorporation] |
| Seat | Berlin, Germany |
| Legal form | GmbH or UG (haftungsbeschränkt) |
| Founding | Planned Q3 2026 |
| Sector | Software / KI / IKT (WZ 62.01 or 62.02) |
| KMU status | Yes (< 10 employees at start) |
| Contact | Felix Niemeyer, [email TBD] |

**Team:**
- **Felix Niemeyer** — Technical founder. Graph engine, agentic architecture, product philosophy.
- **Robin Maier** — Co-founder. Ex-CEO Mindance (B2B mental health, successful exit). MBA WHU. Operations & go-to-market.

---

## 2. Projekttitel

**Transparente Willensmodelle für kooperative Mensch-KI-Agentensysteme (Aimparency)**

---

## 3. Ausgangssituation und Problemstellung

Autonome KI-Agenten (Coding Agents, Operator-Systeme, Multi-Step-Workflows) führen zunehmend komplexe Aufgabenketten aus — oft ohne nachvollziehbare Darstellung von Zielen, Prioritäten und Entscheidungsgrundlagen. Menschen verlieren die Fähigkeit, Absichten zu prüfen, Konflikte zu erkennen und strategisch einzugreifen, ohne die Autonomie des Systems zu zerstören.

Bestehende Projektmanagement- und Agent-Tools modellieren **Aufgaben**, nicht **Absichten**. Es fehlt eine technische Schicht, die explizite Willensmodelle (Zielgraphen) als Koordinationsprimitive für Mensch-KI-Zusammenarbeit bereitstellt — insbesondere für langfristige, domänenübergreifende Vorhaben.

**Stand der Technik:** Task queues, Chat-Interfaces, versteckte Reasoning-Chains. Kein offenes, versioniertes, priorisierbares Willensmodell mit Wert/Kosten-Fluss.

---

## 4. Projektziel und Innovationsgehalt

**Ziel:** Entwicklung eines innovativen Softwaresystems, das autonome KI-Agenten über ein explizites, editierbares Zielgraph-Modell („Aims") mit menschlichen Nutzern koppelt — als **Human-AI Cooperation Engine**.

**Erstinnovation / technische Neuheit:**

1. **Willensmodell statt Task-Liste:** Zielgraph mit gerichteten Unterstützungsbeziehungen, intrinsischem Wert und Kosten — ermöglicht intelligente Priorisierung und Synergieerkennung.
2. **Git-native Persistenz:** Zielzustand als versionierte JSON-Artefakte im Repository — auditierbar, diffbar, agentenlesbar.
3. **Agenten-Orchestrierung:** MCP-basierte Werkzeugintegration; Wrapped Agents (Claude, Gemini, Codex) arbeiten zielgraph-geführt über Sessions hinweg.
4. **Reflexions- und Lernmuster:** Strukturierte Reflections an abgeschlossenen Zielen für sessionübergreifende Verbesserung.
5. **Ökonomische Autonomie-Schicht:** Kosten-/Wert-Tracking für nachhaltige Mensch-KI-Kooperation (Autonomie-Ratio).

**Abgrenzung zu Markt:** Kein weiteres Todo-Board oder Chat-Wrapper. Aimparency ist die **Koordinations- und Legitimitätsschicht** zwischen menschlichen Bedürfnissen und fähiger KI.

**TRL:** Einstieg TRL 4–5 (funktionsfähiger Prototyp, lokale Installation, Agent-Sessions). Ziel TRL 6–7 (robuste Beta, erste zahlende Pilotkunden, dokumentierte Agenten-Loops).

---

## 5. Arbeitsplan und Meilensteine (18 Monate)

### Phase 1: Kern-R&D (Monate 1–6)
- Zielgraph-Engine: Zyklenerkennung, Wertfluss-Berechnung, semantische Suche
- MCP-Server: vollständige Agenten-API für Ziel-/Phasen-Management
- Reflexions-Pattern: automatische Nachbesprechung abgeschlossener Ziele

**Meilenstein M1:** Agent kann Ziel finden → planen → ausführen → verifizieren → Status aktualisieren (discover→plan→execute→verify Loop)

### Phase 2: Kooperation & Persistenz (Monate 7–12)
- Sessionübergreifendes Gedächtnis (Cross-Session Memory)
- Multi-Agenten-Koordination (spezialisierte Sub-Agenten: Researcher, Planner, Implementer, Reviewer)
- Voice-Interface-Prototyp für Ziel-Extraktion aus Konversation

**Meilenstein M2:** Zwei Agenten-Sessions kooperieren am selben Zielgraph ohne Zustandsverlust

### Phase 3: Marktreife & Validierung (Monate 13–18)
- Ökonomisches Dashboard (echte API-Kosten, Autonomie-Ratio)
- Onboarding, Dokumentation, Open-Source-Release des Graph-Kerns
- 3–5 Pilotkunden (Entwickler, technische Gründer)

**Meilenstein M3:** Erster zahlender Kunde; dokumentierte Pilotstudie

---

## 6. Verwertung

- **SaaS / Pay-per-Usage:** Subscription + Compute-Marge (OpenRouter-Routing)
- **Open-Source-Kern:** Graph-UI und `.bowman`-Format frei → Developer Adoption
- **Infrastruktur-Positionierung:** „Will-UI" für Agentic AI — Vergleich: GUI für Betriebssysteme
- **Markt:** Zunächst technische Gründer / Power-User; mittelfristig Infrastrukturschicht für Agenten-Ökosystem

---

## 7. Kostenplan (Zusammenfassung)

| Kategorie | EUR |
|-----------|-----|
| Personalkosten (2 Gründer, Teilzeit R&D) | 55.000 |
| Cloud-/API-Compute (Entwicklung) | 15.000 |
| Software/Lizenzen | 5.000 |
| Externe Beratung (Förderung, Recht) | 5.000 |
| Reise, Workshops, Dissemination | 3.333 |
| **Gesamtkosten** | **83.333** |
| **Beantragte Förderung (60%)** | **50.000** |
| **Eigenanteil** | **33.333** |

---

## 8. Erfolgsaussichten / Risiken

**Stärken:**
- Funktionsfähiger Prototyp (nicht reines Konzeptpapier)
- Klares technisches Differenzierungsmerkmal (Willensmodell)
- Erfahrenes Gründerteam (Exit-Historie Robin; Felix: technische Tiefe + Produktvision)
- Passt zu deutschen KI-Strategiezielen (Transparenz, Vertrauenswürdige KI)

**Risiken & Mitigation:**
- *Markt noch früh:* Open-Source + Developer-Community als Traktionspfad
- *Technische Komplexität Multi-Agent:* Phasenweise Spezialisierung, nicht Big-Bang
- *Wettbewerb durch große Labs:* Positionierung als kooperative Schicht, nicht Ersatz für Foundation Models

---

## 9. Anlagen (bei Einreichung)

- [ ] Handelsregisterauszug / Gesellschaftsvertrag
- [ ] Lebensläufe / Qualifikationsnachweise Gründer
- [ ] Demo-Video (90s, aus `meta/video-pitch-script.md`)
- [ ] Screenshots / Architekturdiagramm
- [ ] GitHub-Repository-Link
- [ ] Ggf. LOI Pilotkunde (David — Solaranlagen-Projekt)

---

## 10. Einreichung

1. GmbH/UG gründen
2. PTJ-Kontakt: [ptj.de](https://www.ptj.de) → ZIM
3. Informelle Voranfrage / Projektskizze einreichen (easy-Online)
4. **Keine Projektausgaben vor Bewilligung**
/**
 * SINGLE SOURCE OF TRUTH for the Installation, Operation & Maintenance manual.
 * Rendered by build-manual.js into BOTH the web page and the downloadable PDF.
 *
 * EDITING NOTES
 * -------------
 * Blocks: {type:'p'|'list'|'steps'|'warning'|'note'|'confirm'|'table'}
 * Inline **bold** is supported. Keep sentences short — installers read this on
 * a phone, on site, in poor light.
 *
 * ⚠ 'confirm' blocks mark values that MUST be supplied/verified by Design &
 * Supply's technical team before this document is treated as final. They are
 * deliberately conspicuous in both outputs. Do NOT copy figures from another
 * manufacturer's manual: a fire or LPS 1175 doorset only performs as certified
 * when installed in the configuration it was tested in, so another company's
 * clearances and fixings would invalidate our certification.
 */
module.exports = {
  metaTitle: "Steel Doorset Installation, Operation & Maintenance Manual | Design & Supply",
  metaDescription:
    "How to install, operate and maintain Design & Supply steel doorsets — site safety, pre-installation checks, fire and LPS 1175 security requirements, handover, inspection schedules and troubleshooting.",
  h1: "Installation, Operation &amp; <em>Maintenance</em>",
  strapline:
    "Everything needed to install, hand over, operate and maintain a Design & Supply steel doorset — written for professional installers and facilities teams. Read it on this page, or download the PDF for your O&M pack.",
  docRef: "DS-IOM-001",
  version: "2.0",
  date: "July 2026",
  pdfFilename: "Design-and-Supply-Installation-Operation-Maintenance-Manual.pdf",

  sections: [
    /* ------------------------------------------------------------------ 1 */
    {
      id: "about",
      title: "About this manual",
      intro:
        "This manual covers Design & Supply steel doorsets: security rated, fire rated, thermal, flood, acoustic, streamline and standard steel personnel doorsets.",
      blocks: [
        {
          type: "p",
          text: "Design & Supply manufactures certified steel doorsets in Merthyr Tydfil. Where we are not contracted to install, we are not responsible for installation. The performance we certify — and the warranty we give — depend on the doorset being installed correctly, complete, and in the configuration in which it was tested.",
        },
        {
          type: "warning",
          title: "Read this before you start",
          text: "Do not begin installation until you have read this manual and the approved drawings supplied with your doorset. Steel doorsets are heavy and can cause serious injury. They are for professional installation only, by competent installers, working to your own risk assessment and method statement.",
        },
        {
          type: "p",
          text: "Methods vary from site to site. The guidance here is general and does not replace the approved drawings, the fixing schedule, or project-specific engineering advice. If site conditions differ from the drawings, stop and speak to us before proceeding.",
        },
        {
          type: "list",
          items: [
            "**Installers** — sections 2 to 10 cover safety, checks, installation and completion.",
            "**Main contractors and clients** — section 11 covers handover and the documentation you must receive.",
            "**Facilities and building managers** — sections 12 to 14 cover operation, inspection, maintenance and fault finding.",
          ],
        },
        {
          type: "note",
          text: "Terms of sale apply. Incorrect installation invalidates the manufacturer's warranty and may invalidate third-party certification. If in doubt, call 01685 350 114 — advice before installation is always cheaper than remedial work after it.",
        },
      ],
    },

    /* ------------------------------------------------------------------ 2 */
    {
      id: "safety",
      title: "Safety before you start",
      blocks: [
        {
          type: "list",
          items: [
            "A steel doorset is a heavy, awkward load. Plan a **minimum of two people** for handling and installation; larger and double doorsets will need more, or mechanical handling.",
            "Carry out a site-specific risk assessment and method statement before work begins, in line with CDM 2015 duties.",
            "Wear appropriate PPE: safety footwear, gloves (cut-resistant for handling steel edges), eye protection when drilling or cutting, and hearing protection where required.",
            "Before drilling into the structure, confirm there are no buried services — electrical cables, gas, water or data — in the fixing zone. Use a cable/pipe detector.",
            "Keep the opening and working area clear. Never leave a leaf or frame free-standing where it can fall.",
            "Working at height, hot works and power tools each carry their own controls. On-site welding must not be carried out without authorisation and, where required, a hot work permit.",
            "Isolate and make safe any powered hardware (mag locks, electric strikes, automatic operators) before working on it.",
          ],
        },
        {
          type: "warning",
          title: "Do not modify the doorset",
          text: "Cutting, drilling, welding or re-machining a certified leaf or frame on site — including for additional ironmongery, vision panels or letterplates — will invalidate its fire and security certification and our warranty. If a change is needed, contact us: modifications must be made in the factory, within the tested scope.",
        },
      ],
    },

    /* ------------------------------------------------------------------ 3 */
    {
      id: "delivery",
      title: "Delivery, storage and handling",
      blocks: [
        {
          type: "steps",
          items: [
            "Check the delivery against the delivery note before signing. Confirm all leaves, frames, hardware packs, keys, seals and fixing kits are present.",
            "Inspect for transit damage — dents, scratches, distortion, damaged edges or packaging. Photograph anything you find.",
            "Report any shortage or transit damage to us immediately, and in any event within 24 hours of delivery. Damage reported later is difficult for us to resolve with the carrier.",
            "Check the label on each doorset against the opening it is intended for. Doorsets are made to order and are not interchangeable between openings.",
          ],
        },
        {
          type: "p",
          text: "Store doorsets **upright and fully supported**, clear of the ground, in a dry, ventilated place. Do not lay leaves flat and stack them — steel leaves can distort under their own weight, and a distorted leaf will not close correctly or perform as certified.",
        },
        {
          type: "list",
          items: [
            "Protect from rain, condensation and standing water. Trapped moisture between packaged leaves causes staining and corrosion, even on powder-coated steel.",
            "Do not store in an unventilated shrink-wrap in direct sun — condensation will form.",
            "Keep clear of plaster, cement, acids and solvents, all of which attack the finish.",
            "Handle by the frame or the leaf edges. Do not lift or drag by the ironmongery.",
            "Leave protective film in place until installation is complete, then remove it promptly — prolonged UV exposure makes film difficult to remove and can mark the finish.",
          ],
        },
      ],
    },

    /* ------------------------------------------------------------------ 4 */
    {
      id: "pre-install",
      title: "Pre-installation checks",
      intro: "Five minutes of checking here prevents most installation problems.",
      blocks: [
        {
          type: "steps",
          items: [
            "Check the structural opening dimensions against the approved drawing — width, height, and diagonals for square.",
            "Check the opening is plumb, level and square. Correct the structure before installing; do not attempt to take up structural error in the doorset.",
            "Confirm the surrounding structure is sound, complete and capable of accepting the specified fixings. Fixing into damaged, incomplete or unsuitable substrate will not achieve the certified performance.",
            "Check the finished floor level. Where floor finishes are still to be laid, confirm the final level so threshold and undercut are correct.",
            "Confirm the handing and opening direction against the drawing — see our handing chart if unsure.",
            "Check the doorset label matches the specification for that opening: fire rating, security rating, and any acoustic or thermal performance.",
            "Locate the fixing kit and the keys before you begin.",
          ],
        },
        {
          type: "confirm",
          text: "Permissible structures for certified doorsets — the wall types, minimum densities and minimum thicknesses our fire and security doorsets are certified for installation into — must be inserted here from our test evidence. This varies by product and by certificate and must not be generalised.",
        },
        {
          type: "warning",
          title: "Damaged openings",
          text: "Damage to the structure around a fire-resisting doorset must be recorded and brought to the client's attention before installation proceeds. A fire doorset cannot perform correctly in a compromised opening.",
        },
      ],
    },

    /* ------------------------------------------------------------------ 5 */
    {
      id: "tools",
      title: "Tools and fixings",
      blocks: [
        {
          type: "p",
          text: "Use the fixings supplied. They are specified as part of the tested and certified configuration. Substituting a different fixing type, size, or quantity — or omitting fixing positions — changes the performance of the doorset and invalidates its certification.",
        },
        {
          type: "list",
          items: [
            "Spirit level (1m minimum) and a longer straightedge for tall openings",
            "Tape measure and squaring gauge or laser",
            "SDS drill with correctly sized masonry bits for the specified fixings",
            "Suitable driver bits, spanners and hex keys for the supplied fixings and adjusters",
            "Packers and shims, folding wedges",
            "Cable and pipe detector",
            "Silicone gun for perimeter sealing, and the correct sealant for the application",
            "Cut-resistant gloves, eye protection, and lifting aids appropriate to the doorset weight",
          ],
        },
        {
          type: "confirm",
          text: "Specific fixing types, sizes, spacings and centres for each doorset type must be inserted here from our fixing schedules — including the minimum number of fixings per jamb and head, and any differences for fire-rated and security-rated doorsets.",
        },
      ],
    },

    /* ------------------------------------------------------------------ 6 */
    {
      id: "installation",
      title: "Installing the doorset",
      intro:
        "The sequence below is the general method. Always work to the approved drawings supplied with your doorset — they take precedence over this summary.",
      blocks: [
        {
          type: "steps",
          items: [
            "Offer the frame into the structural opening and support it. On a single doorset it is usually easiest to remove the leaf first; on a double doorset, fix the passive leaf jamb first and leave the active leaf free.",
            "Establish the hinge jamb first. Plumb it in both planes and check it is straight along its full height — this jamb governs how the whole doorset will hang.",
            "Pack behind the frame at each fixing position, so the fixing bears against solid packing and the jamb is not pulled out of line when tightened.",
            "Fix the hinge jamb progressively, checking plumb after each fixing. Do not fully tighten everything before checking alignment.",
            "Re-hang the leaf (or close the passive leaf) and check it sits correctly against the frame with an even margin along its full height.",
            "Adjust and fix the strike jamb to suit the leaf, keeping the margin consistent top to bottom. Fix the head last.",
            "Install the remaining fixings in every position provided. Do not add or omit fixings.",
            "Check the leaf swings freely, closes fully under its own weight where a closer is fitted, and latches cleanly without binding or being forced.",
            "Seal the perimeter as specified, and make good.",
          ],
        },
        {
          type: "confirm",
          text: "Target margins and clearances — leaf-to-frame gap, meeting-stile gap on double doorsets, and threshold undercut — must be inserted here for each product type. These are tested values, differ between fire and non-fire doorsets, and must come from our own test evidence.",
        },
        {
          type: "note",
          text: "Steel doorsets are heavy and site openings are rarely perfect. Some adjustment is normal. What is not acceptable is forcing a doorset into an out-of-tolerance opening — it will bind, drop, or fail to latch, and on a fire or security doorset it will not perform as certified.",
        },
      ],
    },

    /* ------------------------------------------------------------------ 7 */
    {
      id: "fire",
      title: "Fire-rated doorsets — additional requirements",
      intro:
        "A fire doorset is a life-safety product. It performs only as a complete assembly, installed as tested, with all its components present and correct.",
      blocks: [
        {
          type: "list",
          items: [
            "Install strictly in accordance with the approved drawings and the fixing schedule. Every fixing position provided must be used.",
            "Use only the intumescent and smoke seals supplied, in the positions shown. Do not substitute, omit, paint over or overstretch them.",
            "Fit only ironmongery that is within the tested and certified scope of the doorset. Uncertified hardware invalidates the fire rating.",
            "Seal the perimeter gap between frame and structure with a fire-rated sealant suitable for the gap size and substrate.",
            "Do not cut, drill or weld the leaf or frame on site.",
            "Ensure the doorset closes fully and latches from any open position, unaided. A fire door that does not latch does not work.",
            "Replace any certification label removed during installation. If it cannot be replaced, obtain a replacement from us — do not leave a certified doorset unlabelled.",
          ],
        },
        {
          type: "warning",
          title: "Clearances are critical",
          text: "Gaps around a fire doorset are part of the tested design. Too large and fire and smoke pass; too small and the door binds as it expands. Work to the tolerances on the approved drawing for your specific doorset — never to figures taken from another manufacturer's literature.",
        },
        {
          type: "confirm",
          text: "Insert here, from our own EN 1634-1 test evidence and certification: the permitted leaf-to-frame clearances and tolerances; the maximum threshold undercut (insulated and uninsulated); intumescent seal type, size and positions for each configuration; the maximum permissible perimeter gap and the approved fire sealants; and the specific fire ratings and durations certified for each product, with certificate references.",
        },
        {
          type: "p",
          text: "On completion, the person responsible for the building must be given the fire safety information for the doorsets installed. This supports the client's duties under the Building Regulations and, in occupation, under the Regulatory Reform (Fire Safety) Order 2005. See section 11.",
        },
      ],
    },

    /* ------------------------------------------------------------------ 8 */
    {
      id: "security",
      title: "Security-rated doorsets — additional requirements",
      intro:
        "Design & Supply steel doorsets are certified by the LPCB and listed in the LPCB Red Book. The certified rating belongs to the complete doorset as tested — including how it is fixed into the structure.",
      blocks: [
        {
          type: "table",
          head: ["Certificate", "Standard", "Products", "Rating"],
          rows: [
            ["694b", "LPS 1175 Issue 7", "Desray 1 / Desray 2 / DS3", "SR1, SR2, SR3"],
            ["694d", "LPS 1175 Issue 8", "DS4 single and double leaf", "D10 (SR4)"],
            ["694e", "LPS 1175 Issue 8", "Slimline Janisol / Economy 60", "B3 (SR2)"],
            ["694c", "LPS 2081 Issue 1", "Slimline Janisol / Economy 60", "Rating B"],
          ],
        },
        {
          type: "note",
          text: "LPS 1175 Issue 8 uses a tool-category and time notation — for example D10 — which supersedes the older SR1 to SR8 scale. Both are shown above so specifications written either way can be matched. Current listings can be checked on the LPCB Red Book.",
        },
        {
          type: "list",
          items: [
            "The security rating depends on the substrate. Fixing a certified doorset into a structure weaker than that specified will not deliver the certified resistance, however well the doorset itself is made.",
            "Use the specified fixings, in every position provided. Security performance is a function of how the frame is anchored.",
            "Fit only the certified locking and hardware specified for that doorset. Substituted locks, cylinders or keeps invalidate the rating.",
            "Do not modify the leaf, frame, or anchor points on site.",
            "Check the doorset operates correctly, and that locking engages fully, before handover.",
            "Replace any security certification label removed during installation.",
          ],
        },
        {
          type: "confirm",
          text: "Insert here, from our LPS 1175 certification: the approved substrates and minimum specifications for each security rating; the specified anchor type, size, spacing and embedment; and any additional requirements for SR3 and SR4 doorsets, which typically differ from lower ratings.",
        },
      ],
    },

    /* ------------------------------------------------------------------ 9 */
    {
      id: "seals",
      title: "Seals",
      blocks: [
        {
          type: "p",
          text: "Doorsets may be supplied with intumescent seals, smoke seals, weather seals, acoustic seals, or a combination. Each does a different job and each must be installed in the position shown on the drawing supplied with the doorset.",
        },
        {
          type: "list",
          items: [
            "**Intumescent seals** expand under heat to close the gap between leaf and frame. Mandatory on fire-rated doorsets, in the positions tested.",
            "**Smoke seals** limit the passage of cold smoke and are usually a brush or fin seal.",
            "**Weather seals** exclude wind and rain on external doorsets and contribute to thermal and water-tightness performance.",
            "**Acoustic seals** must be continuous and correctly compressed to achieve the rated sound reduction — a small gap disproportionately reduces acoustic performance.",
          ],
        },
        {
          type: "steps",
          items: [
            "Check the seal grooves are clean, dry and free of paint, dust and debris before fitting.",
            "Fit seals in continuous lengths wherever possible; avoid unnecessary joints, and never leave gaps at corners.",
            "Do not stretch seals while fitting — they will shrink back and leave gaps at the ends.",
            "Where a seal must pass hardware, trim neatly around it rather than leaving the seal proud or bridging it.",
            "Check the door closes and latches correctly after fitting; seals add resistance and may require closer adjustment.",
          ],
        },
        {
          type: "confirm",
          text: "Insert the seal schedule here: seal type, size and exact positions for each doorset type and configuration (single, double, fire, acoustic, external), and the permitted trimming method around hardware.",
        },
      ],
    },

    /* ----------------------------------------------------------------- 10 */
    {
      id: "completion",
      title: "Completion checks",
      intro: "Work through this before leaving site. Record the result.",
      blocks: [
        {
          type: "list",
          items: [
            "Frame is plumb, level and square; margins are consistent along the full height of the leaf.",
            "All fixings are installed in every position provided, and are tight and secure.",
            "The leaf opens and closes freely through its full arc, without binding or catching.",
            "The door latches cleanly from any open position, without being pushed or lifted.",
            "Where a closer is fitted, the door closes fully and latches under closer action alone.",
            "On double doorsets, both leaves close in the correct sequence and meet correctly.",
            "All ironmongery operates correctly: locks, cylinders, handles, panic hardware, hold-opens.",
            "Keys are present, operate correctly, and are ready to hand over.",
            "Seals are continuous, correctly seated and undamaged.",
            "Perimeter is sealed and made good; packing is not visible or proud.",
            "Certification labels are present and legible.",
            "Protective film removed; doorset cleaned; finish inspected for damage and touched up if required.",
            "Work area left clean, with all waste and packaging removed.",
          ],
        },
        {
          type: "warning",
          title: "Powered and escape hardware",
          text: "Where panic or emergency exit hardware is fitted, confirm the door releases correctly from the inside with a single action, every time. Where powered locking is fitted, confirm it fails safe as designed, and that it releases on fire alarm activation where it is interfaced with the fire system.",
        },
      ],
    },

    /* ----------------------------------------------------------------- 11 */
    {
      id: "handover",
      title: "Handover and documentation",
      blocks: [
        {
          type: "p",
          text: "On completion, demonstrate operation to the client, hand over the keys, and provide the documentation for the doorsets installed. Keep a record of the installation — including what was installed, where, by whom, and the completion checks carried out.",
        },
        {
          type: "list",
          items: [
            "This installation, operation and maintenance manual",
            "Product data sheets for the doorsets supplied",
            "Certification details for fire-rated and security-rated doorsets",
            "Declaration of Performance where applicable",
            "Keys, and any hardware documentation supplied with the doorset",
            "A record of the completed installation and completion checks",
          ],
        },
        {
          type: "p",
          text: "Where fire doorsets have been installed, fire safety information must be passed to the person responsible for the building on completion, so that it is available for the building's fire risk assessment and ongoing management. For higher-risk buildings, this information also forms part of the information that must be kept and maintained under the Building Safety Act 2022.",
        },
        {
          type: "note",
          text: "Design & Supply is a DHF member. Where we install, our work follows DHF TS 005, the industry standard for the installation of doors and shutters, including its requirements for installation records and completion certificates.",
        },
      ],
    },

    /* ----------------------------------------------------------------- 12 */
    {
      id: "operation",
      title: "Operation",
      blocks: [
        {
          type: "list",
          items: [
            "Open and close doorsets using the handles or push furniture provided. Do not push or pull on glazing, louvres or seals.",
            "Never wedge, prop, tie or otherwise hold open a fire door. If a door needs to stand open, it must be fitted with a certified hold-open or free-swing device linked to the fire alarm.",
            "Do not hang loads from the leaf, or use the door as a restraint for other equipment.",
            "Do not obstruct the swing of the door, or store materials against it.",
            "Escape doors must remain unobstructed and immediately openable from the inside at all times.",
            "Report damage, binding, failure to latch, or any hardware fault promptly — a fire or security doorset that is not working correctly is not providing the protection it was specified for.",
          ],
        },
        {
          type: "warning",
          title: "Fire doors",
          text: "A fire door only works when it is closed. Wedging a fire door open is one of the most common and most serious fire safety failings in occupied buildings.",
        },
      ],
    },

    /* ----------------------------------------------------------------- 13 */
    {
      id: "maintenance",
      title: "Maintenance and inspection",
      intro:
        "Steel doorsets are robust but not maintenance-free. Regular inspection keeps them safe, compliant and long-lived — and catches small faults before they become door replacements.",
      blocks: [
        {
          type: "table",
          head: ["Interval", "Action"],
          rows: [
            ["Monthly", "Visual check: damage, corrosion, missing or loose hardware, damaged seals, obstruction. Check the door closes and latches."],
            ["Quarterly", "Operational check: full swing, latching from any position, closer action and speed, locking, panic hardware, hold-open devices. Check fixings are tight."],
            ["Six-monthly", "Clean and lubricate hinges, locks and closers as below. Check glazing and beads, louvres and grilles. Inspect finish and touch up damage."],
            ["Annually", "Full inspection of the complete doorset including seals, frame fixings, threshold and perimeter seal. Record the outcome and rectify defects."],
            ["Coastal / corrosive sites", "Increase cleaning frequency — wash down at least quarterly, and more often where salt or industrial deposits are heavy."],
          ],
        },
        {
          type: "note",
          text: "These are general recommendations. Fire doors in occupied buildings carry statutory duties, and in some buildings — for example blocks of flats above a specified height — the responsible person must carry out fire door checks at set intervals. Check the requirements that apply to your building and set your inspection regime accordingly. Where a doorset is in heavy use, inspect more frequently.",
        },
        {
          type: "p",
          text: "**Inspection points.** On each doorset, check: leaf alignment and margins; that the door closes fully and latches unaided; hinge condition and fixing security; closer operation and any leaking fluid; lock, cylinder and keep operation; panic and emergency hardware function; seal continuity and condition; glazing, beads and louvres; frame fixings; threshold condition; corrosion, particularly at the bottom of the leaf and frame; and that certification labels are still present and legible.",
        },
        {
          type: "p",
          text: "**Cleaning.** Wash powder-coated steel with clean water and a mild pH-neutral detergent, using a soft cloth or sponge. Rinse thoroughly and dry. Never use abrasive pads, scouring powders, or solvent-based cleaners — they will dull and damage the coating and can void the finish warranty. Clean stainless steel hardware in the direction of the grain.",
        },
        {
          type: "p",
          text: "**Lubrication.** Lubricate hinges and moving hardware with a light machine oil or the lubricant recommended by the hardware manufacturer. Use a graphite or PTFE-based lubricant in cylinders — not oil, which attracts dirt and eventually gums the mechanism. Wipe away excess so it does not mark the finish.",
        },
        {
          type: "p",
          text: "**Touching up.** Repair scratches and chips promptly, especially on external and coastal doorsets, to prevent corrosion spreading beneath the coating. Contact us for a colour-matched touch-up to your doorset's specification.",
        },
        {
          type: "warning",
          title: "Certified doorsets",
          text: "Maintenance must not alter the doorset outside its certified configuration. Replacement seals, hardware and components on fire and security doorsets must match the original specification. If a certified component needs replacing, contact us for the correct part rather than fitting a generic equivalent.",
        },
        {
          type: "p",
          text: "Keep a record of every inspection and any work carried out. For fire doorsets this record is evidence of compliance, and will be asked for.",
        },
      ],
    },

    /* ----------------------------------------------------------------- 14 */
    {
      id: "troubleshooting",
      title: "Troubleshooting",
      intro:
        "Common faults, likely causes, and what to do. Anything affecting a fire or security rating should be referred to us rather than adjusted on site.",
      blocks: [
        {
          type: "table",
          head: ["Symptom", "Likely cause", "Action"],
          rows: [
            [
              "Door binds or catches on the frame",
              "Frame out of plumb or square; fixings over-tightened pulling the jamb in; structural movement; swollen or displaced seal",
              "Check plumb and margins. Slacken and re-pack the affected fixing rather than forcing the leaf. Check seals are seated, not proud.",
            ],
            [
              "Leaf has dropped or is sagging",
              "Hinge fixings loose; worn hinge; frame movement; door has been hung on or overloaded",
              "Check and tighten hinge fixings. If a hinge is worn or damaged, replace with the same specified hinge — not a generic substitute on a certified doorset.",
            ],
            [
              "Door will not latch",
              "Misalignment between latch and keep; closer too weak or misadjusted; seal resistance; leaf binding",
              "Check alignment of latch to keep and adjust the keep if adjustment is provided. Check closer power and final closing speed. Do not file or enlarge the keep on a certified doorset — contact us.",
            ],
            [
              "Doorset appears twisted; leaf does not sit flat to the frame",
              "Opening out of square or out of plane; frame installed to a twisted opening; incorrect packing; leaf distorted by flat storage",
              "Check the opening in both planes. This usually needs the frame re-set rather than adjustment at the leaf. Contact us before attempting to correct a twisted certified doorset.",
            ],
            [
              "Closer slams, closes too slowly, or fails to close fully",
              "Closer speed and latch valves misadjusted; closer undersized for the leaf; low temperature affecting fluid; worn or leaking closer",
              "Adjust the closing and latching speed valves per the closer manufacturer's instructions. Replace a leaking closer. On a fire door the closer must fully close and latch the door from any position.",
            ],
            [
              "Lock or cylinder stiff or not operating",
              "Lack of lubrication; dirt ingress; misalignment putting load on the bolt; worn cylinder or key",
              "Lubricate the cylinder with graphite or PTFE. Check the door is not binding — a stiff lock is often an alignment problem, not a lock problem.",
            ],
            [
              "Electric strike or mag lock not releasing",
              "No power or incorrect voltage; wiring fault; incorrect fail-safe / fail-secure configuration; strike misaligned; interface with fire alarm not correct",
              "Confirm supply voltage at the device and check wiring against the hardware manufacturer's diagram. Powered escape and fire-interfaced hardware must be checked by a competent person — confirm it releases on alarm.",
            ],
            [
              "Panic hardware stiff or not releasing cleanly",
              "Misalignment; lack of lubrication; damage; obstruction; door binding",
              "Escape hardware must release with a single action every time. If it does not, take the door out of service for escape purposes and rectify immediately.",
            ],
            [
              "Water ingress at the threshold or perimeter",
              "Perimeter seal failed or incomplete; weather seal damaged or worn; incorrect threshold detail; blocked drainage",
              "Inspect and renew the perimeter seal and weather seals. Check the cill and threshold detail against the drawing.",
            ],
            [
              "Corrosion or paint damage",
              "Coating damaged in transit, installation or use; coastal or industrial exposure; harsh cleaning products; standing water",
              "Clean, prepare and touch up promptly with a colour-matched repair. Review the cleaning regime. For persistent corrosion on a newer doorset, contact us.",
            ],
            [
              "Seal damaged, loose or missing",
              "Impact damage; poor original fit; stretched during installation; painted over",
              "Replace with the correct specified seal. On a fire doorset the intumescent seal is a certified component — it must be replaced like for like, in the correct position.",
            ],
          ],
        },
        {
          type: "warning",
          title: "When to stop and call us",
          text: "Contact Design & Supply rather than adjusting on site if: a fire or security doorset does not close and latch correctly; a certified component is damaged or missing; the doorset is twisted or distorted; a certification label is missing; or a repair would involve cutting, drilling or welding a certified leaf or frame. Call 01685 350 114.",
        },
      ],
    },

    /* ----------------------------------------------------------------- 15 */
    {
      id: "warranty",
      title: "Warranty and support",
      blocks: [
        {
          type: "p",
          text: "Our doorsets are warranted against defects in materials and manufacture, subject to our terms and conditions of sale. The warranty depends on correct installation, correct use, and the maintenance regime in section 13 being followed and recorded.",
        },
        {
          type: "list",
          items: [
            "Damage caused by incorrect installation, including the use of fixings other than those specified, is not covered.",
            "Site modification of a certified leaf or frame voids both the warranty and the certification.",
            "Damage from impact, misuse, harsh cleaning products, or lack of maintenance is not covered.",
            "Corrosion arising from failure to repair coating damage, or from an inappropriate specification for the environment, is not covered.",
          ],
        },
        {
          type: "p",
          text: "For technical advice, replacement certified components, colour-matched touch-up, or to arrange a site visit, contact us. If you have a Customer Portal login you can also track live orders through production at designandsupply.co.uk/portal.",
        },
        {
          type: "note",
          text: "Design & Supply Ltd · 13 Pant Industrial Estate, Merthyr Tydfil, Mid Glamorgan, CF48 2SR · 01685 350 114 · sales@designandsupply.co.uk",
        },
      ],
    },
  ],
};

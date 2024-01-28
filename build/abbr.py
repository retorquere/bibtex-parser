#!/usr/bin/env python3

import json
from pathlib import Path
import re
import urllib.request
import csv
import glob

unabbr = {}
with open('build/strings-base.bib') as f:
  strings = f.read()

with open('node_modules/unicode2latex/tables/biblatex.json') as f:
  u2l = json.load(f)
def unicode2latex(s):
  l = ''
  for c in s:
    if not c in u2l:
      l += c
    elif 'text' in u2l[c]:
      l += u2l[c]['text']
    else:
      l += '$' + u2l[c]['math'] + '$'
  return l.replace('$$', '')

def minimize(s):
  return re.sub(r'[.\s]', '', s)

def accept(abbr, full):
  if len(minimize(full)) <= len(minimize(abbr)): return False
  if len(abbr) == 0: return False
  if '$' in full: return False
  if '"' in full: return False
  if '...' in full: return False
  if unthe(full).lower() == 'journal' and unthe(abbr).lower() == 'journal': return False
  return True

def clean(abbr, full):
  global strings
  abbr = abbr.upper().strip()
  if len(abbr) < 2: return ''
  if abbr[0] == '#' and abbr[-1] == '#':
    abbr = abbr[1:-2]
    if '"' not in full and accept(abbr, full): strings += '@string{' + abbr + ' = "' + unicode2latex(full) + '"}\n'
  return abbr

def unthe(j):
  for prefix in ['^the ', '^la ']:
    if re.match(prefix, j, re.I): return re.sub(prefix, '', j, flags=re.I).strip()
  return j

with open('build/unabbrev-base.json') as f:
  base = json.load(f)
  for abbr, full in base.items():
    abbr = clean(abbr, full)
    unabbr[abbr] = full

for abbrevs in glob.glob('abbrv.jabref.org/journals/journal_abbreviations_*.csv'):
  with open(abbrevs) as f:
    for full, abbr in [row[:2] for row in csv.reader(f, delimiter=';') if len(row) >= 2]:
      abbr = clean(abbr, full)
      if not accept(abbr, full): continue
      unabbr[abbr] = full

for path in Path('abbreviations').rglob('*.json'):
  if path.name in ['header.json', 'footer.json']: continue
  with open(str(path)) as f:
    for full, abbr in json.load(f)['default']['container-title'].items():
      abbr = clean(abbr, full)
      if not accept(abbr, full): continue

      if abbr in unabbr:
        existing = unabbr[abbr]
        if existing == full: continue
        if unthe(unabbr[abbr]).lower() == unthe(full):
          full = unthe(full)
        elif existing.lower().startswith(full.lower()):
          pass
        elif full.lower().startswith(existing.lower()):
          full = existing
        else:
          print((abbr, existing, full))
          if len(existing) > len(full): full = existing

      unabbr[abbr] = full

fixups = {
  "A. U. U. ST. GE.": "Acta Universitatis Upsaliensis : Studia Germanistica Upsaliensia",
  "AAPG MEMOIR.": "AAPG Memoirs",
  "ACT. ACAD. AB.": "Acta Academiae Aboensis : Ser B Math Et Phys",
  "ACTA UNIV. PALACK. OLOMUC. FAC. RERUM NATUR. MATH.": "Acta Universitatis Palackianae Olomucensis. Facultas Rerum Naturalium. Mathematica",
  "ADV. AIR POLLUT. SER.": "Advances in Air Pollution Series",
  "ADV. BOUND. ELEM. SER.": "Boundary Elements XXIV: Incorporating Meshless Solutions",
  "ADV. PUBLIC. INTER. ACC.": "Extending Schumacher's Concept of Total Accounting and Accountability Into The 21st Century",
  "ADV. UNDERWAT. TECHNOL.": "Subsea Control and Data Acquisition for Oil and Gas Production Systems",
  "AGID. GEO. IN.": "Agid Report Series : Geosciences in International Development",
  "AIR WATER SOIL SCI T": "Traffic Related Air Pollution and Internal Combustion Engines",
  "AL RAIDA": "al-Raida / Institute for Women's Studies in the Arab World, Beirut University College",
  "AN. UNIV. CRAIOVA SER. MAT. INFORM.": "Analele Universitatii din Craiova. Seria Matematica-Informatica. Annals of the University of Craiova. Mathematics and Computer Science Series",
  "ANN. INST. PASTEUR VIR.": "Annales De L Institut Pasteur-virology",
  "ANN. ACAD. SCI. FENN. MATH. DISS.": "Academi\u00e6 Scientiarum Fennicae. Annales. Mathematica. Dissertationes",
  "ANN. FOND. LOUIS DE BROGLIE": "Fondation Louis de Broglie. Annales",
  "ANN. INST. PASTEUR. IMM.": "Annales de'l Institut Pasteur-immunology",
  "ANN. INST. PASTEUR. MIC.": "Annales de'l Institut Pasteur-microbiologie",
  "ANN. INST. PASTEUR. VIR.": "Annales de'l Institut Pasteur-virology",
  "AQUAC. ASSOC. CAN. SPEC.": "Aquaculture Association of Canada Special Publication",
  "ARCH. MECH. (ARCH. MECH. STOS.)": "Polish Academy of Sciences. Institute of Fundamental Technological Research. Archives of Mechanics (Archiwum Mechaniki Stosowanej)",
  "ARCH. P. AMER. ANT. ASSO.": "Archeological Papers of The American Anthropological Association",
  "ARCHEOL. PAP. AM. ANTHR.": "Housework: Craft Production and Domestic Economy in Ancient Mesoamerica",
  "ASA. DECEN. CONF. SER.": "Future of Anthropological Knowledge",
  "ASSIST. TECHN. RES. SER.": "Technology and Aging",
  "ASSIST. TECHNOL. RES. S.": "Smart Homes and Beyond",
  "BIB. LIT. MODERN.": "Bibliotheque De Litterature Moderne",
  "BIBL. STOR. T.": "Biblioteca Storica Toscana : Sezione Di Storia Del Risorgimento",
  "BIOSYSTEMS": "Bio Systems",
  "BIOTECH. AGR. FOREST.": "Plant Biotechnology for Sustainable Production of Energy and Co-products",
  "BR. CROP. PR.": "Seed Treatment: Progress and Prospects",
  "BRILLS. TIBET. STU. LIB.": "Tibetan Buddhist Literature and Praxis: Studies in Its Formative Period, 900-1400",
  "BULL. COLL. LIB. ARTS": "Wen shi zhe xue bao",
  "BULL. AMER. MATH. SOC. (N.S.)": "American Mathematical Society. Bulletin. New Series",
  "BULL. FAC. ED. KAGOSHIMA UNIV. NATUR. SCI.": "Bulletin of the Faculty of Education. Kagoshima University. Natural Science",
  "BUSINESSINDIA": "Business India",
  "CANCER. DRUG. DISCOV. D.": "Macromolecular Anticancer Therapeutics",
  "CCAST. WL. SW.": "Surface Physics",
  "CLIN. PHYS.": "Clinical Physiology Series",
  "COMM. STATIST. THEORY METHODS": "Communications in Statistics. Theory and Methods",
  "COMP. EXPTL. METHODS.": "Moving Boundaries Vii: Computational Modelling of Free and Moving Boundary Problems",
  "CONDENS. MATTER. RES. T.": "Physical Properties of The Low-dimensional A3b6 and A3b3c62 Compounds",
  "CONF. PROC. LECT. NOT. G.": "Geometry, Topology & Physics",
  "CONTEMP. HIST. CON. SER.": "Contemporary History in Context Series",
  "CONTEMP. PHILOS. NEW. S.": "Contemporary Philosophy-new Survery",
  "CONTR. AM. HI.": "Contributions in American History",
  "CROSS. CONT.": "Cultural Approaches to Parenting",
  "DEPRESS. CAUSES. DIAGN.": "Depression-causes Diagnosis and Treatment",
  "DIAGN. CLIN. IMMUNOL.": "Diagnostic and Clinical Immunology",
  "DISCUSS. MATH. GRAPH THEORY": "Discussiones Mathematicae. Graph Theory",
  "FOR. CAN. NOR.": "Forestry Canda Modeling Working Group : Proceedings of The Fifth Annual Workshop",
  "FRONT. SOC. PSYCHOL.": "Social Cognition: The Basis of Human Interaction",
  "GLAS. MAT. SER. III": "Glasnik Matematicki. Serija III",
  "GOTEB. UNIV. DEP. SOCIO.": "Goteborg University - Department of Sociology Monograph",
  "HARV. S. UKRAIN. ST.": "Harvard Series in Ukrainian Studies",
  "IZV. MATH.": "Izvestiya. Mathematics",
  "IZV. ROSS. AKAD. NAUK SER. MAT.": "Rossiiskaya Akademiya Nauk. Izvestiya. Seriya Matematicheskaya",
  "J. EAST CHINA NORM. UNIV. NATUR. SCI. ED.": "Journal of East China Normal University. Natural Science Edition. Huadong Shifan Daxue Xuebao. Ziran Kexue Ban",
  "J. FUZHOU UNIV. NAT. SCI. ED.": "Journal of Fuzhou University. Natural Science Edition. Fuzhou Daxue Xuebao. Ziran Kexue Ban",
  "J. INST. MATH. COMPUT. SCI. COMPUT. SCI. SER.": "Institute of Mathematics & Computer Sciences. Journal. (Computer Science Series)",
  "J. MATH. SCI. UNIV. TOKYO": "The University of Tokyo. Journal of Mathematical Sciences",
  "J. MATH. TOKUSHIMA UNIV.": "Journal of Mathematics. Tokushima University",
  "J. NANJING NORM. UNIV. NAT. SCI. ED.": "Journal of Nanjing Normal University. Natural Science Edition. Nanjing Shida Xuebao. Ziran Kexue Ban",
  "J. SCI. ISLAM. REPUB. IRAN": "Islamic Republic of Iran. Journal of Sciences",
  "J. SOUTH CHINA NORMAL UNIV. NATUR. SCI. ED.": "Journal of South China Normal University. Natural Science Edition. Huanan Shifan Daxue Xuebao. Ziran Kexue Ban",
  "J. SOUTHEAST UNIV. (ENGLISH ED.)": "Journal of Southeast University. English Edition. Dongnan Daxue Xuebao. Yingwen Ban",
  "J. WUHAN UNIV. NATUR. SCI. ED.": "Journal of Wuhan University. Natural Science Edition. Wuhan Daxue Xuebao. Lixue Ban",
  "J. ZHENGZHOU UNIV. NAT. SCI. ED.": "Journal of Zhengzhou University. Natural Science Edition. Zhengzhou Daxue Xuebao. Lixue Ban",
  "KONG. DANSK. VIDENSK.": "Kongelige Danske Videnskabernes Selskab: Matematisk-fysiske Meddelelser",
  "LIMNOL. AKT.": "Limnologie Aktuell",
  "LITURG CONDENDA": "Liturgy and Muse",
  "MANUF. ENG. MATER. PROC.": "Manufacturing Engineering and Materials Processing",
  "MAT. LAPOK (N.S.)": "Matematikai Lapok. New Series",
  "MATH. BALKANICA (N.S.)": "Mathematica Balkanica. New Series",
  "MD. ANDERSON. SOLID. TU.": "Md Anderson Solid Tumor Oncology Series",
  "METHOD. CELL BIOL.": "Neurons: Methods and Applications for The Cell Biologist",
  "METHODS. MOL. BIOL.": "Rt-pcr Protocols, Second Edition",
  "MINN. STUD. PHILOS. SCI.": "Minnesota Studies in The Philosophy of Science",
  "NEUROTRAUM.": "Neural Monitoring",
  "NEW. CRIT. IDIOM.": "New Critical Idiom",
  "NUCLEAR PHYS. B": "Nuclear Physics. B. Theoretical, Phenomenological, and Experimental High Energy Physics. Quantum Field Theory and Statistical Systems",
  "OCC. P. INST. MEN. STUD.": "Occasional Papers of The Institute of Mennonite Studies",
  "PEMB. PERS. PAP.": "Pembroke Persian Papers",
  "PHOTOCHEM-SPEC. PERIO.": "Photochemistry-a Specialist Periodical Report",
  "PROG. RESPIR. RES.": "Progress in Respiratory Research",
  "PUBL PUBLIC HEALTH UNIV CALIF": "Publications in public health. University of California (1868-1952)",
  "PUBL. GER. HIST. INST.": "Publications of The German Historical Institute",
  "Q. REV. CHEM. SOC.": "Quarterly Reviews, Chemical Society",
  "REV. BULL. CALCUTTA MATH. SOC.": "Calcutta Mathematical Society. Review Bulletin",
  "REV. INTEGR. TEMAS MAT.": "Revista Integracion. Temas de Matematicas",
  "ROUT. STUD. PHILOS. REL.": "Routledge Studies in The Philosophy of Religion",
  "ROUTL PHILOS": "Routledge Philosophers",
  "ROUTL. EUR. SOCIOL. ASS.": "Routledge European Sociological Association Studies in European Societies",
  "ROUTL. HINDU. STUD. SER.": "Self-surrender (prapatti) to God in Srivaisnavism: Tamil Cats and Sanskrit Monkeys",
  "ROUTL. PHILOS.": "Routledge Philosophers",
  "ROUTL. STUD. ECOL. ECON.": "Routledge Studies in Ecological Economics",
  "RUTG. SELF SOC. ID.": "Rutgers Series On Self and Social Identity",
  "SB. MATH.": "Sbornik. Mathematics",
  "SELECTA MATH. (N.S.)": "Selecta Mathematica. New Series",
  "STATE. ARTS. SER.": "State-of-the-arts Series",
  "STUD. BUS. CYCLES.": "Business Cycles, Indicators and Forecasting",
  "STUD. INTERCULT. PHIL.": "Studies in Intercultural Philosophy",
  "TECH. DOC. HY.": "Technical Documents in Hydrology",
  "TECHNIKGESCHICHTE": "Technik Geschichte",
  "TEXTS THEORET. COMPUT. SCI. EATCS SER.": "Texts in Theoretical Computer Science. An EATCS Series",
  "VDI BERICHT.": "35 Vdi Jahrestagung Schadensanalyse:produktverbesserung Durch Schadensanalyse",
  "PHYS. STATUS SOLIDI RRL - RAPID RES. LETT.": "physica status solidi (RRL) \u2013 Rapid Research Letters",
  "J. Phys. Conf. Ser.": "Journal of physics. Conference series",
}
for abbr, full in fixups.items():
  unabbr[abbr] = full
  unabbr[abbr.replace('.', '')] = full

with open('unabbrev.json', 'w') as f:
  json.dump(unabbr, f, indent='  ', sort_keys=True)

def fetch(name):
  return urllib.request.urlopen('https://www.netlib.org/bibnet/tools/strings/' + name).read().decode('utf-8')

for bib in fetch('00dir.cmd').split('\n'):
  if not bib.endswith('.bib'): continue
  bib = re.sub('^get ', '', bib)
  strings += f'%% {bib}\n{fetch(bib)}\n'
with open('strings.bib', 'w') as f:
  f.write(strings)

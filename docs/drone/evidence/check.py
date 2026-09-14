"""Check scoped document joins, source fingerprints and preserved contracts.

Run from any directory: python3 docs/drone/evidence/check.py
This is structural/provenance validation, not full guideline or flight certification.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess

evidence = Path(__file__).resolve().parent
root = evidence.parents[2]
plan = evidence.parent / 'prd-tad-adr-mvp-gtm-gamexr-esp32-drone-control.md'
snapshot = json.loads((evidence / 'source-snapshot.json').read_text())
results = []


def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def check(name, condition):
    results.append({'name': name, 'passed': bool(condition)})


content = plan.read_text()
front = dict(re.findall(r'^([a-z0-9_]+): "([^"\n]*)"$', content.split('---', 2)[1], re.M))
check('exact-five-role-join', front.get('continuity_id') == 'DRONE-RC-001'
      and all(front.get(role + '_revision') == '0.2.0' for role in ['prd', 'tad', 'adr', 'mvp', 'gtm']))
check('role-locators', all('\n## ' + role + '\n' in content for role in ['PRD', 'TAD', 'ADR', 'MVP', 'GTM']))
check('prd-owns-host-criteria', content.index('| HA1 ') < content.index('\n## TAD\n'))
check('tad-owns-host-contracts', content.index('\n## TAD\n') < content.index('I1-H:') < content.index('\n## ADR\n'))
check('source-fingerprints', all((root / name).is_file() and sha(root / name) == digest
      for name, digest in snapshot['files'].items()))
check('verifier-fingerprint', sha(Path(__file__)) == snapshot['verifier_sha256'])
provenance = json.loads((evidence.parent / 'history/provenance.json').read_text())
archive = evidence.parent / 'history' / provenance['archive_locator']
original = archive.read_text().replace(provenance['archive_parent_locator'], provenance['original_parent_locator'])
check('original-specification-preserved', sha(archive) == provenance['archive_sha256']
      and hashlib.sha256(original.encode()).hexdigest() == snapshot['specification_input']['sha256'])
check('active-plan-budget', len(content.splitlines()) < 600 and len(content.encode()) < 500_000)
missing = []
for doc in [plan, root / 'docs/DRONE-CONTROL.md', evidence.parent / 'history' / (plan.stem + '-v0.1.0.md')]:
    for link in re.findall(r'\]\(([^)]+)\)', doc.read_text()):
        if link.startswith(('https://', 'http://', '#')):
            continue
        if not (doc.parent / link.split('#')[0]).resolve().exists():
            missing.append(str(doc) + ': ' + link)
check('local-links', not missing)
unchanged = subprocess.check_output(['git', 'diff', snapshot['base_revision'],
    '--name-only', '--diff-filter=MDRT', '--', 'tests', 'browser-tests', 'native', 'vendor', 'src/mcp'], cwd=root, text=True)
check('existing-tests-native-shared-pins-and-game-api-preserved', not unchanged.strip())
guideline = root / snapshot['guideline']['archive']
check('guideline-input-bound', guideline.is_file() and sha(guideline) == front['guideline_sha256'])
report = {'schema': 'drone-host-provenance-check/v1', 'checks': results,
          'passed': all(result['passed'] for result in results), 'missing_links': missing,
          'scope': '11 selected structural/provenance checks; no exhaustive guideline alignment claim'}
print(json.dumps(report, indent=2))
raise SystemExit(0 if report['passed'] else 1)

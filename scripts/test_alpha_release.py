"""Execute the real release command against a local gh stub; never contact GitHub."""
import os
import shutil
import subprocess
import tempfile
import textwrap
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = (root / '.github/workflows/release.yml').read_text(encoding='utf-8')
nightly = (root / '.github/workflows/nightly.yml').read_text(encoding='utf-8')
assert 'ref: ${{ needs.plan.outputs.sha }}' not in nightly, 'nightly checks out trusted main, not an output-controlled ref'
assert 'test "$(git rev-parse HEAD)" = "${PLANNED_SHA}"' in nightly, 'main must still match the planned source revision'
publish = source.split('      - name: Create the release\n', 1)[1].split('        run: |\n', 1)[1]
script = textwrap.dedent(publish)
bash = shutil.which('bash') if os.name != 'nt' else 'C:/Program Files/Git/bin/bash.exe'
with tempfile.TemporaryDirectory(prefix='everloot-release-') as temp:
    folder = Path(temp)
    subprocess.run(['git', 'init', '--quiet', temp], check=True)
    stub = folder / 'bin'
    stub.mkdir()
    gh = stub / 'gh'
    gh.write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURE_ARGS"\n', encoding='utf-8')
    gh.chmod(0o755)
    posix = stub.as_posix()
    if os.name == 'nt':
        posix = '/' + posix[0].lower() + posix[2:]
    run = folder / 'release.sh'
    run.write_text(f'export PATH="{posix}:$PATH"\n' + script, encoding='utf-8')
    for notes, alpha in [('Release channel: Alpha\nLive-client verification pending.\n', True), ('Stable release.\n', False)]:
        (folder / 'release-notes.md').write_text(notes, encoding='utf-8')
        capture = folder / 'args.txt'
        env = dict(os.environ, GITHUB_REF_NAME='addon-v0.3.11', CAPTURE_ARGS=capture.as_posix())
        for secret in ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']:
            env.pop(secret, None)
        subprocess.run([bash, '--noprofile', '--norc', '-e', run.as_posix()], cwd=temp, env=env, check=True)
        args = capture.read_text(encoding='utf-8').splitlines()
        assert ('--prerelease' in args) == alpha, args
for name in ['nightly.yml', 'release.yml']:
    workflow = (root / '.github/workflows' / name).read_text(encoding='utf-8')
    for contract in ['planner_contract.py', 'raid_plan_contract.py']:
        assert contract in workflow, (name, contract)
print('Alpha release classification and planner publication contracts: PASS')

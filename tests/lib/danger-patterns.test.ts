import { describe, expect, it } from 'vitest';
import { detectDanger, parse, RULES, suggestDanger, underDeclared } from '../../src/lib/danger-patterns';

const ids = (command: string) => detectDanger(command).map((r) => r.id);

// One or more commands per rule. Every rule must be listed here (checked below).
const POSITIVE: Record<string, string[]> = {
  'rm-recursive': ['rm -rf /tmp/x', 'sudo rm -fr {{path}}', 'rm -R dir', 'rm --recursive dir', 'rm -f -r dir', '/bin/rm -r x', 'find . -name "*.log" -exec rm -r {} +', 'ls | xargs rm -rf'],
  'find-delete': ['find {{path}} -mtime +30 -delete', 'find {{path}} -type {{f|d}} -empty -delete -print'],
  'dd-write': ['dd if=image.iso of=/dev/sdb bs=4M', 'sudo dd if=/dev/zero of={{device}}'],
  mkfs: ['mkfs.ext4 /dev/sdb1', 'sudo mkfs -t xfs {{device}}'],
  wipefs: ['wipefs -a /dev/sdb'],
  shred: ['shred -u secret.txt'],
  'raw-disk-write': ['cat image > /dev/sda', 'echo x >/dev/nvme0n1', 'cat x > /dev/disk2'],
  'fork-bomb': [':(){ :|:& };:', ': ( ) { : | : & } ; :'],
  'pipe-to-shell': ['curl -fsSL https://x.sh | sh', 'wget -qO- https://x | sudo bash', 'bash -c "$(curl -fsSL https://x)"', 'bash <(curl -s https://x)'],
  'base64-to-shell': ['echo ZWNobw== | base64 -d | sh', 'base64 --decode payload | bash'],
  'terraform-destroy': ['terraform destroy', 'terraform apply -destroy -auto-approve'],
  'kubectl-delete': ['kubectl delete pod {{pod}}', 'kubectl -n prod delete deployment web'],
  'helm-uninstall': ['helm uninstall {{release}}', 'helm delete my-release'],
  'git-push-force': ['git push --force', 'git push -f origin main', 'git push origin +main'],
  'git-reset-hard': ['git reset --hard HEAD~1'],
  'git-clean-force': ['git clean -fd', 'git clean --force'],
  'docker-prune': ['docker system prune -a', 'docker volume prune'],
  'rsync-delete': ['rsync -a --delete src/ dst/', 'rsync -r --delete-after {{src}} {{dst}}', 'rsync -a --remove-source-files a b'],
  'docker-volume-remove': ['docker compose down --volumes', 'docker compose down -v --rmi all', 'docker-compose down -v', 'docker volume rm {{volume}}'],
  'aws-s3-rm-recursive': ['aws s3 rm s3://bucket/ --recursive', 'aws s3 rb s3://bucket --force'],
  rm: ['rm file.txt', 'docker rm {{container}}'],
  'chmod-777': ['chmod -R 777 /var/www', 'chmod 0777 file'],
  'kill-force': ['kill -9 {{pid}}', 'kill -s KILL 42', 'pkill nginx', 'killall node'],
  'force-flag': ['git push --force-with-lease', 'apt-get install --force-yes x', 'docker rmi --force=true x'],
};

// Frequent safe commands that must not trigger anything.
const SAFE = [
  'ls -la',
  'ls -f',
  'tail -f /var/log/syslog',
  'grep -r "error" /var/log',
  'rmdir empty-dir',
  'git push origin main',
  'git reset --soft HEAD~1',
  'git status',
  'du -h --max-depth=1 . | sort -h',
  'find / -type f -size +1G 2>/dev/null',
  'kubectl get pods -A',
  'terraform plan',
  'helm list',
  'docker ps -a',
  'curl -fsSL https://example.com -o install.sh',
  'base64 -d file > out.bin',
  'echo hi > /dev/null',
  'chmod 644 file',
  'kill {{pid}}',
  'aws s3 ls s3://bucket --recursive',
  'dd --help',
  'docker compose down',
  'docker run -v /data:/data {{image}}',
  'rsync -av {{src}} {{dst}}',
];

describe('danger rules', () => {
  it('has positive examples for every rule', () => {
    expect(Object.keys(POSITIVE).sort()).toEqual(RULES.map((r) => r.id).sort());
  });

  for (const [id, commands] of Object.entries(POSITIVE)) {
    it.each(commands)(`${id}: %s`, (command) => {
      expect(ids(command)).toContain(id);
    });
  }

  it.each(SAFE)('no false positive: %s', (command) => {
    expect(ids(command)).toEqual([]);
  });
});

describe('suggestDanger', () => {
  it.each([
    ['ls -la', 'safe'],
    ['rm file', 'caution'],
    ['rm -rf dir', 'destructive'],
    ['kill -9 1 && terraform destroy', 'destructive'],
  ])('%s → %s', (command, level) => {
    expect(suggestDanger(command)).toBe(level);
  });
});

describe('underDeclared', () => {
  it('flags every rule above the declared level', () => {
    expect(underDeclared('rm -rf x', 'safe').map((r) => r.id)).toEqual(['rm-recursive', 'rm']);
    expect(underDeclared('rm -rf x', 'caution').map((r) => r.id)).toEqual(['rm-recursive']);
    expect(underDeclared('rm -rf x', 'destructive')).toEqual([]);
  });

  it('accepts a level higher than needed', () => {
    expect(underDeclared('ls', 'destructive')).toEqual([]);
  });
});

describe('placeholders', () => {
  it('a "|" inside a placeholder does not split the command', () => {
    expect(parse('find . -type {{f|d}} -delete').segments).toEqual([['find', '.', '-type', 'f', 'd', '-delete']]);
  });

  it('checks the default value, which is what gets copied', () => {
    expect(ids('{{cmd:rm -rf /tmp/x}}')).toContain('rm-recursive');
    expect(ids('echo {{url:https://example.com}}')).toEqual([]);
  });
});

describe('parse', () => {
  it('splits pipes, lists and substitutions and strips quotes', () => {
    expect(parse('a "b" | c && d; $(e f) `g`').segments).toEqual([['a', 'b'], ['c'], ['d'], ['e', 'f'], ['g']]);
  });
});

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');

async function main() {
  const [sourcePath, destinationPath] = process.argv.slice(2).map((value) => path.resolve(value));
  if (!sourcePath || !destinationPath || sourcePath === destinationPath) {
    throw new Error('Usage: node snapshot-auth-db.js SOURCE_SQLITE DESTINATION_SQLITE');
  }

  const tempPath = `${destinationPath}.snapshot.tmp`;
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    fs.rmSync(tempPath, { force: true });
    await backup(source, tempPath);
  } finally {
    source.close();
  }

  const snapshot = new DatabaseSync(tempPath, { readOnly: true });
  try {
    const result = snapshot.prepare('PRAGMA integrity_check').get();
    if (result.integrity_check !== 'ok') {
      throw new Error(`SQLite snapshot integrity check failed: ${result.integrity_check}`);
    }
  } finally {
    snapshot.close();
  }

  fs.copyFileSync(tempPath, destinationPath);
  fs.rmSync(tempPath);
  console.log('Admin settings database snapshot verified and installed.');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

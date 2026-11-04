import * as argon2 from 'argon2';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import dataSource from '../database/data-source';
import { completePlatformOwnerBootstrap } from './platform-owner-bootstrap.service';

function readHiddenPassword(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
      reject(new Error('A real interactive terminal is required.'));
      return;
    }

    let password = '';

    stdout.write(`${prompt} (input hidden): `);
    stdin.setRawMode(true);
    stdin.resume();

    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdout.write('\n');
    };

    const onData = (chunk: Buffer | string) => {
      const input = chunk.toString();

      for (const character of input) {
        if (character === '\u0003') {
          cleanup();
          reject(new Error('Password entry cancelled.'));
          return;
        }

        if (character === '\r' || character === '\n') {
          cleanup();
          resolve(password);
          return;
        }

        if (character === '\u007f' || character === '\b') {
          password = password.slice(0, -1);
          continue;
        }

        if (character >= ' ') {
          password += character;
        }
      }
    };

    stdin.on('data', onData);
  });
}

async function bootstrapPlatformOwner(): Promise<void> {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error('Run this command from an interactive terminal.');
  }

  const terminal = createInterface({ input: stdin, output: stdout });

  let fullName: string;
  let email: string;

  try {
    console.log('\nAssetPass — Initial Platform Owner Bootstrap');
    console.log('This operation can only be completed once.\n');

    fullName = (await terminal.question('Full name: ')).trim();
    email = (await terminal.question('Email address: ')).trim().toLowerCase();
  } finally {
    terminal.close();
  }

  if (!fullName || fullName.length > 200) {
    throw new Error('Owner name is required and must not exceed 200 characters.');
  }

  if (
    !email ||
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new Error('A valid owner email address is required.');
  }

  let password = await readHiddenPassword('Initial owner password');

  if (password.length < 14 || password.length > 1024) {
    password = '';
    throw new Error('Password must contain between 14 and 1024 characters.');
  }

  const passwordConfirmation = await readHiddenPassword(
    'Confirm initial owner password',
  );

  if (password !== passwordConfirmation) {
    password = '';
    throw new Error('Passwords do not match. Bootstrap cancelled.');
  }

  const confirmationTerminal = createInterface({
    input: stdin,
    output: stdout,
  });

  let confirmation: string;

  try {
    confirmation = await confirmationTerminal.question(
      'Confirm initial owner creation? Type YES: ',
    );
  } finally {
    confirmationTerminal.close();
  }

  if (confirmation.trim() !== 'YES') {
    password = '';
    throw new Error('Bootstrap cancelled. No changes were made.');
  }

  let passwordHash: string;

  try {
    passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
    });
  } finally {
    password = '';
  }

  await dataSource.initialize();

  try {
    const savedOwner = await completePlatformOwnerBootstrap(dataSource, {
      fullName,
      email,
      passwordHash,
    });

    console.log('\nPlatform bootstrap completed successfully.');
    console.log(`Initial Platform Owner: ${fullName}`);
    console.log(`Email: ${email}`);
    console.log(`User ID: ${savedOwner.id}`);
    console.log('Role: Platform Owner');
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

bootstrapPlatformOwner().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'An unexpected error occurred.';

  console.error(`\nPlatform bootstrap failed: ${message}`);
  process.exitCode = 1;
});

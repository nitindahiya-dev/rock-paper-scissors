// pages/api/withdraw.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import prisma from '../../lib/prisma';

// Use your provided RPC server link
const connection = new Connection(
  'https://solana-devnet.g.alchemy.com/v2/2y2go7slvFxJvVMFGbh_AT-9L5WQ-_pc',
  'finalized'
);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { publicKey } = req.body;
  if (!publicKey || typeof publicKey !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid publicKey' });
  }

  try {
    // Fetch the user from your database
    const user = await prisma.user.findUnique({ where: { publicKey } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const amountSOL = user.balance;
    if (amountSOL <= 0) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Limit the airdrop to a maximum of 2 SOL
    const maxAirdropSOL = 2;
    const requestedSOL = Math.min(amountSOL, maxAirdropSOL);
    const lamports = Math.floor(requestedSOL * LAMPORTS_PER_SOL);

    // Attempt the airdrop request up to 3 times
    let txSignature: string | undefined;
    const maxAirdropRetries = 3;
    for (let i = 0; i < maxAirdropRetries; i++) {
      try {
        txSignature = await connection.requestAirdrop(
          new PublicKey(publicKey),
          lamports
        );
        console.log(`Airdrop succeeded on attempt ${i + 1}. TxSignature: ${txSignature}`);
        break; // Exit the loop if successful
      } catch (err) {
        console.error(`Airdrop request failed on attempt ${i + 1}:`, err);
        if (i === maxAirdropRetries - 1) {
          throw new Error('Airdrop failed after multiple attempts.');
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    if (!txSignature) {
      throw new Error('No transaction signature received from airdrop.');
    }


    // Confirm the transaction by polling every 2 seconds for up to 120 seconds (60 attempts)
    let retries = 60;
    while (retries > 0) {
      const status = await connection.getSignatureStatus(txSignature);
      console.log("Current confirmation status:", status?.value?.confirmationStatus);
      if (
        status?.value?.confirmationStatus === 'confirmed' ||
        status?.value?.confirmationStatus === 'finalized'
      ) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
      retries--;
    }

    if (retries === 0) {
      throw new Error('Transaction not confirmed in time.');
    }

    // Once confirmed, update the user's balance to 0
    await prisma.user.update({
      where: { publicKey },
      data: { balance: 0 },
    });

    console.log(`Withdrawal successful for ${publicKey}`);
    res.status(200).json({ success: true, txSignature });
  } catch (error) {
    console.error('Error processing withdrawal:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  createMint,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { HyperlocalMarkets } from "../target/types/hyperlocal_markets";

const ZK_LOCATION_PROGRAM_ID = new anchor.web3.PublicKey(
  "zkLocaTion111111111111111111111111111111111"
);

const MARKET_SEED = "market";
const USER_STATE_SEED = "user-state";
const USER_POS_SEED = "user-position";

function questionSeed(question: string): Buffer {
  const bytes = Buffer.from(question, "utf8");
  return bytes.slice(0, Math.min(bytes.length, 32));
}

async function createMockUserLocation({
  provider,
  user,
  regionId,
}: {
  provider: anchor.AnchorProvider;
  user: anchor.web3.PublicKey;
  regionId: Buffer;
}) {
  const [pda, bump] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(USER_STATE_SEED), user.toBuffer()],
    ZK_LOCATION_PROGRAM_ID
  );
  const data = Buffer.alloc(8 + 1 + 8 + 32 + 32); // disc + bool + u64 + nullifier + region
  // Discriminator for "account:UserLocationState"
  const name = "account:UserLocationState";
  Buffer.from(anchor.utils.sha256.hash(name)).copy(data, 0, 0, 8);
  data.writeUInt8(1, 8); // is_verified = true
  data.writeBigUInt64LE(BigInt(0), 9); // last_verified_slot
  // nullifier left zeroed at offset 17..49
  regionId.copy(data, 9 + 8 + 32); // region at offset 49
  // nullifier left as zeros by default

  const tx = new anchor.web3.Transaction().add(
    anchor.web3.SystemProgram.createAccount({
      fromPubkey: provider.wallet.publicKey,
      newAccountPubkey: pda,
      lamports: await provider.connection.getMinimumBalanceForRentExemption(
        data.length
      ),
      space: data.length,
      programId: ZK_LOCATION_PROGRAM_ID,
    }),
    new anchor.web3.TransactionInstruction({
      keys: [
        {
          pubkey: pda,
          isSigner: false,
          isWritable: true,
        },
      ],
      programId: ZK_LOCATION_PROGRAM_ID,
      data,
    })
  );
  await provider.sendAndConfirm(tx, []);
  return { pda, bump };
}

describe("hyperlocal_markets dpm", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace
    .HyperlocalMarkets as Program<HyperlocalMarkets>;

  const payer = provider.wallet as anchor.Wallet;

  async function setupMintAndVault() {
    const mint = await createMint(
      provider.connection,
      payer.payer,
      payer.publicKey,
      null,
      6
    );

    const marketQuestion = "Test market for bbox";
    const [marketPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from(MARKET_SEED), payer.publicKey.toBuffer(), questionSeed(marketQuestion)],
      program.programId
    );

    const user = anchor.web3.Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user.publicKey, 2e9),
      "confirmed"
    );
    const userAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      mint,
      user.publicKey
    );
    // Mint some USDC to user.
    await mintTo(
      provider.connection,
      payer.payer,
      mint,
      userAta.address,
      payer.publicKey,
      1_000_000_000 // 1000 USDC (6 decimals)
    );

    return { mint, marketQuestion, marketPda, user, userAta };
  }

  it("creates market and enforces region check", async () => {
    const { mint, marketQuestion, marketPda, user, userAta } =
      await setupMintAndVault();

    const regionId = Buffer.from(Array(32).fill(7));

    // PDAs
    const vaultAta = await getAssociatedTokenAddress(mint, marketPda, true);

    const [userLocPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from(USER_STATE_SEED), user.publicKey.toBuffer()],
      ZK_LOCATION_PROGRAM_ID
    );
    await createMockUserLocation({
      provider,
      user: user.publicKey,
      regionId,
    });

    await program.methods
      .createMarket(regionId as any, marketQuestion, new anchor.BN(Date.now() / 1000 + 3600))
      .accounts({
        payer: payer.publicKey,
        market: marketPda,
        usdcMint: mint,
        vault: vaultAta,
        resolver: payer.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const marketBefore = await program.account.market.fetch(marketPda);
    // Place YES order
    const [userPosPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from(USER_POS_SEED), marketPda.toBuffer(), user.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .placeOrder(new anchor.BN(100_000_000), { yes: {} })
      .accounts({
        trader: user.publicKey,
        market: marketPda,
        userLocation: userLocPda,
        userPosition: userPosPda,
        traderUsdc: userAta.address,
        vault: marketBefore.vault,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const marketAfter = await program.account.market.fetch(marketPda);
    const userPos = await program.account.userPosition.fetch(userPosPda);
    expect(marketAfter.totalPool.toNumber()).toBeGreaterThan(0);
    expect(userPos.yesShares.toNumber()).toBeGreaterThan(0);

    // Out of region should fail
    const otherUser = anchor.web3.Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(otherUser.publicKey, 2e9),
      "confirmed"
    );
    const otherAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer.payer,
      mint,
      otherUser.publicKey
    );
    await mintTo(
      provider.connection,
      payer.payer,
      mint,
      otherAta.address,
      payer.publicKey,
      100_000_000
    );
    const otherRegion = Buffer.from(Array(32).fill(9));
    const [otherLocPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from(USER_STATE_SEED), otherUser.publicKey.toBuffer()],
      ZK_LOCATION_PROGRAM_ID
    );
    await createMockUserLocation({
      provider,
      user: otherUser.publicKey,
      regionId: otherRegion,
    });
    const [otherUserPos] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from(USER_POS_SEED), marketPda.toBuffer(), otherUser.publicKey.toBuffer()],
      program.programId
    );

    await expect(
      program.methods
        .placeOrder(new anchor.BN(10_000_000), { yes: {} })
        .accounts({
          trader: otherUser.publicKey,
          market: marketPda,
          userLocation: otherLocPda,
          userPosition: otherUserPos,
          traderUsdc: otherAta.address,
          vault: marketAfter.vault,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([otherUser])
        .rpc()
    ).rejects.toThrow();
  });
});

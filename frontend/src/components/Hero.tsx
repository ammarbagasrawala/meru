import ConnectButton from "./ConnectButton";

export default function Hero() {
  return (
    <header className="px-6 py-8 sm:py-14 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="text-[11px] uppercase tracking-wider text-emerald-700 font-semibold">
            0G APAC Hackathon · Track 5 · Privacy & Sovereign Infrastructure
          </div>
        </div>
        <ConnectButton />
      </div>

      <div className="mt-8 text-center">
        <h1 className="font-brand text-4xl sm:text-6xl font-semibold">Meru</h1>
        <p className="mt-3 text-lg sm:text-xl text-zinc-600 dark:text-zinc-400 max-w-2xl mx-auto">
          Confidential AI you can audit — so your bank can finally say yes to ChatGPT.
        </p>
        <blockquote className="mt-6 text-sm italic text-zinc-500">
          “Privacy is hygiene.” — Vitalik Buterin, 2025
        </blockquote>
        <p className="mt-6 text-sm text-zinc-600 max-w-3xl mx-auto leading-relaxed">
          Encrypted documents land on <strong>0G Storage</strong>. Inference runs through{" "}
          <strong>0G Sealed Inference</strong> (TEE-attested). Every query emits a signed bundle anchored on{" "}
          <strong>0G Chain</strong> and re-attested on <strong>Sepolia</strong>. Customers get LLM-quality
          answers. Regulators get a tamper-evident audit trail.{" "}
          <span className="text-zinc-500 italic">
            v1 trust boundary includes the backend; enclave-only data flow is the next hardening step (see THREAT-MODEL.md).
          </span>
        </p>
        <div className="mt-6 text-[11px] text-zinc-500">
          EU AI Act Art. 12 · DPDPA Rule 4 · W3C VC v2.0 compatible
        </div>
      </div>
    </header>
  );
}

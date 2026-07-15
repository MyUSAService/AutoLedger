"use client";

import { useEffect, useState, useCallback } from "react";

interface WizardQuestion {
  key: string;
  section: string;
  sectionTitle: string;
  sectionHelp: string;
  type: "yesno" | "choice" | "amount" | "text" | "loan_details";
  text: string;
  choices?: { value: string; label: string }[];
  answered: boolean;
  answer: unknown;
}

interface WizardData {
  title: string;
  intro: string;
  progress: string;
  doneTitle: string;
  doneBody: string;
  questions: WizardQuestion[];
}

interface Labels {
  save: string; saved: string; skip: string; yes: string; no: string;
  continue: string; loading: string; error: string;
  lender: string; originalAmount: string; currentBalance: string; monthlyPayment: string; rate: string;
}

export function QuestionnaireWizard({ labels }: { labels: Labels }) {
  const [data, setData] = useState<WizardData | null>(null);
  const [error, setError] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/client/questionnaire");
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function submit(key: string, answer: unknown) {
    setSavingKey(key);
    try {
      const res = await fetch("/api/client/questionnaire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionKey: key, answer }),
      });
      if (!res.ok) throw new Error();
      await load(); // refresh progress + answered states (save & resume friendly)
    } catch {
      setError(true);
    } finally {
      setSavingKey(null);
    }
  }

  if (error) return <p className="mt-8 text-sm text-red-600">{labels.error}</p>;
  if (!data) return <p className="mt-8 text-sm text-gray-400">{labels.loading}</p>;

  const open = data.questions.filter((q) => !q.answered);
  const sections = groupBySection(data.questions);

  return (
    <div className="mt-4">
      <h1 className="text-2xl font-semibold mb-2">{data.title}</h1>
      <p className="text-sm text-gray-500 mb-2">{data.intro}</p>
      <p className="text-xs font-medium text-gray-400 mb-8">{data.progress}</p>

      {open.length === 0 ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6">
          <h2 className="font-semibold text-green-900">{data.doneTitle}</h2>
          <p className="text-sm text-green-800 mt-1">{data.doneBody}</p>
        </div>
      ) : (
        <div className="space-y-8">
          {sections.map(({ title, help, questions }) => {
            const openQs = questions.filter((q) => !q.answered);
            if (openQs.length === 0) return null;
            return (
              <section key={title}>
                <h2 className="font-semibold">{title}</h2>
                <p className="text-xs text-gray-500 mb-3">{help}</p>
                <div className="space-y-3">
                  {openQs.map((q) => (
                    <QuestionCard key={q.key} q={q} labels={labels} saving={savingKey === q.key} onSubmit={submit} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function groupBySection(questions: WizardQuestion[]) {
  const out: { title: string; help: string; questions: WizardQuestion[] }[] = [];
  for (const q of questions) {
    const last = out[out.length - 1];
    if (last && last.title === q.sectionTitle) last.questions.push(q);
    else out.push({ title: q.sectionTitle, help: q.sectionHelp, questions: [q] });
  }
  return out;
}

function QuestionCard({
  q, labels, saving, onSubmit,
}: {
  q: WizardQuestion;
  labels: Labels;
  saving: boolean;
  onSubmit: (key: string, answer: unknown) => void;
}) {
  const [text, setText] = useState("");
  const [amount, setAmount] = useState("");
  const [loan, setLoan] = useState({ lender: "", originalAmount: "", currentBalance: "", monthlyPayment: "", rate: "" });

  const toCents = (s: string) => Math.round(parseFloat(s.replace(",", ".")) * 100);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-sm mb-3">{q.text}</p>

      {q.type === "yesno" && (
        <div className="flex gap-2">
          <button disabled={saving} onClick={() => onSubmit(q.key, { value: "yes" })}
            className="px-4 py-1.5 rounded-md text-sm bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50">
            {labels.yes}
          </button>
          <button disabled={saving} onClick={() => onSubmit(q.key, { value: "no" })}
            className="px-4 py-1.5 rounded-md text-sm border border-gray-300 hover:bg-gray-50 disabled:opacity-50">
            {labels.no}
          </button>
        </div>
      )}

      {q.type === "choice" && (
        <div className="flex flex-col gap-2">
          {q.choices?.map((c) => (
            <button key={c.value} disabled={saving} onClick={() => onSubmit(q.key, { value: c.value })}
              className="text-left px-4 py-2 rounded-md text-sm border border-gray-300 hover:border-gray-900 hover:bg-gray-50 disabled:opacity-50">
              {c.label}
            </button>
          ))}
        </div>
      )}

      {q.type === "amount" && (
        <form onSubmit={(e) => { e.preventDefault(); const c = toCents(amount); if (!isNaN(c) && c >= 0) onSubmit(q.key, { amountCents: c }); }}
          className="flex gap-2">
          <div className="relative">
            <span className="absolute left-3 top-1.5 text-gray-400 text-sm">$</span>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
              className="border border-gray-300 rounded-md pl-7 pr-3 py-1.5 text-sm w-40" placeholder="0.00" />
          </div>
          <button type="submit" disabled={saving || amount === ""}
            className="px-4 py-1.5 rounded-md text-sm bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50">
            {labels.save}
          </button>
          <button type="button" disabled={saving} onClick={() => onSubmit(q.key, { amountCents: 0 })}
            className="px-3 py-1.5 rounded-md text-xs text-gray-400 hover:underline">
            {labels.skip}
          </button>
        </form>
      )}

      {q.type === "text" && (
        <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) onSubmit(q.key, { text: text.trim() }); }} className="flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)}
            className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-sm" />
          <button type="submit" disabled={saving || !text.trim()}
            className="px-4 py-1.5 rounded-md text-sm bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50">
            {labels.save}
          </button>
        </form>
      )}

      {q.type === "loan_details" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const balance = toCents(loan.currentBalance);
            if (!loan.lender.trim() || isNaN(balance)) return;
            onSubmit(q.key, {
              loan: {
                lender: loan.lender.trim(),
                originalAmountCents: loan.originalAmount ? toCents(loan.originalAmount) : undefined,
                currentBalanceCents: balance,
                monthlyPaymentCents: loan.monthlyPayment ? toCents(loan.monthlyPayment) : undefined,
                annualRatePct: loan.rate ? parseFloat(loan.rate.replace(",", ".")) : undefined,
              },
            });
          }}
          className="grid grid-cols-2 gap-2"
        >
          <Field label={labels.lender} value={loan.lender} onChange={(v) => setLoan((s) => ({ ...s, lender: v }))} />
          <Field label={labels.originalAmount} value={loan.originalAmount} onChange={(v) => setLoan((s) => ({ ...s, originalAmount: v }))} money />
          <Field label={labels.currentBalance} value={loan.currentBalance} onChange={(v) => setLoan((s) => ({ ...s, currentBalance: v }))} money />
          <Field label={labels.monthlyPayment} value={loan.monthlyPayment} onChange={(v) => setLoan((s) => ({ ...s, monthlyPayment: v }))} money />
          <Field label={labels.rate} value={loan.rate} onChange={(v) => setLoan((s) => ({ ...s, rate: v }))} suffix="%" />
          <div className="flex items-end">
            <button type="submit" disabled={saving || !loan.lender.trim() || !loan.currentBalance}
              className="px-4 py-1.5 rounded-md text-sm bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50">
              {labels.save}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function Field({
  label, value, onChange, money, suffix,
}: {
  label: string; value: string; onChange: (v: string) => void; money?: boolean; suffix?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500">{label}</span>
      <div className="relative mt-0.5">
        {money && <span className="absolute left-2.5 top-1.5 text-gray-400 text-sm">$</span>}
        <input inputMode={money ? "decimal" : undefined} value={value} onChange={(e) => onChange(e.target.value)}
          className={`w-full border border-gray-300 rounded-md py-1.5 text-sm ${money ? "pl-6 pr-2" : "px-2.5"}`} />
        {suffix && <span className="absolute right-2.5 top-1.5 text-gray-400 text-sm">{suffix}</span>}
      </div>
    </label>
  );
}

import { NextRequest, NextResponse } from "next/server";
import { requireClient, AuthError } from "@/lib/auth";
import { getCurrentEngagement, getQuestionnaireForEngagement, getAnswers, saveAnswer } from "@/services/clientPortal";
import { getLocale } from "@/lib/locale";
import { t } from "@/i18n";

export async function GET() {
  try {
    const user = await requireClient();
    const engagement = await getCurrentEngagement(user.clientId);
    if (!engagement) return NextResponse.json({ error: "no_engagement" }, { status: 404 });

    const locale = await getLocale(engagement.client.language);
    const questions = await getQuestionnaireForEngagement(engagement.id);
    const answers = await getAnswers(engagement.id);

    // Resolve all copy server-side so the client bundle stays dumb.
    const localized = questions.map((q) => ({
      key: q.key,
      section: q.section,
      sectionTitle: t(locale, `q.section.${q.section === "flags" ? "owner" : q.section}`),
      sectionHelp: t(locale, `q.section.${q.section === "flags" ? "owner" : q.section}.help`),
      type: q.type,
      text: t(locale, q.i18nKey, q.vars),
      choices: q.choices?.map((c) => ({ value: c.value, label: locale === "it" ? c.labelIt : c.labelEn })),
      answered: q.key in answers,
      answer: answers[q.key] ?? null,
    }));

    return NextResponse.json({
      locale,
      intro: t(locale, "q.intro"),
      title: t(locale, "q.title"),
      progress: t(locale, "q.progress", {
        answered: localized.filter((q) => q.answered).length,
        total: localized.length,
      }),
      doneTitle: t(locale, "q.done.title"),
      doneBody: t(locale, "q.done.body"),
      questions: localized,
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireClient();
    const engagement = await getCurrentEngagement(user.clientId);
    if (!engagement) return NextResponse.json({ error: "no_engagement" }, { status: 404 });

    const { questionKey, answer } = (await req.json()) as { questionKey?: string; answer?: unknown };
    if (!questionKey || answer === undefined) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

    // Answers only accepted for questions that actually exist right now.
    const questions = await getQuestionnaireForEngagement(engagement.id);
    const question = questions.find((q) => q.key === questionKey);
    if (!question) return NextResponse.json({ error: "unknown_question" }, { status: 400 });

    await saveAnswer(engagement.id, question, answer, user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }
}

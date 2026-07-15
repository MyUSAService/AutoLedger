import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { getCurrentEngagement } from "@/services/clientPortal";
import { getLocale } from "@/lib/locale";
import { t } from "@/i18n";
import { ClientDropzone } from "./dropzone";

export const dynamic = "force-dynamic";

export default async function ClientUploadPage() {
  const user = await getSessionUser();
  if (!user || user.role !== "CLIENT" || !user.clientId) redirect("/login");
  const engagement = await getCurrentEngagement(user.clientId);
  if (!engagement) redirect("/login");
  const locale = await getLocale(engagement.client.language);

  return (
    <div className="max-w-2xl mx-auto">
      <Link href="/client" className="text-sm text-gray-400 hover:underline">← {t(locale, "common.back")}</Link>
      <h1 className="text-2xl font-semibold mt-4 mb-2">{t(locale, "upload.title")}</h1>
      <p className="text-sm text-gray-500 mb-6">{t(locale, "upload.help")}</p>
      <ClientDropzone
        labels={{
          dropzone: t(locale, "upload.dropzone"),
          uploading: t(locale, "upload.uploading"),
          processing: t(locale, "upload.processing"),
          error: t(locale, "common.error"),
        }}
      />
    </div>
  );
}

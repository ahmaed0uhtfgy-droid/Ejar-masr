# إيجار مصر — ejar-masr.pages.dev

منصة عربية (RTL) لعرض وحدات الإيجار في مصر. الستاك مجاني بالكامل: Vite + React + TS + Tailwind، Cloudflare Pages + Pages Functions، Firebase Spark (Auth + Firestore)، Cloudinary Free، Leaflet + OSM.

## تشغيل محلي
```bash
npm install
cp .env.example .env            # املا بيانات Firebase (Project settings > Your apps)
npm run dev
```
فحوصات: `npm run typecheck && npm run lint && npm test && npm run build`

## الإعداد (مرة واحدة)
1. **Firebase (Spark)**: فعّل Authentication (Email/Password + Google) وأنشئ Firestore. أضف `ejar-masr.pages.dev` في Authentication > Settings > Authorized domains.
2. **نشر القواعد والفهارس**: `firebase deploy --only firestore:rules,firestore:indexes` (الملفين `firestore.rules` و`firestore.indexes.json`). الفهارس بتتولّد بـ `npm run gen:data`.
3. **أول أدمن**: سجّل حساب من الموقع، وبعدها من Firebase console > Firestore > `users/{uid}` غيّر `role` إلى `admin`.
4. **Cloudinary (Free)**: خد `cloud name` و`API key` و`API secret`. مفيش unsigned preset — الرفع بتوقيع من `/api/sign-upload`.
5. **Cloudflare Pages**: اربط الريبو. Build command `npm run build`، output `dist`، ومتغيّرات البناء `VITE_FIREBASE_*` و`VITE_SITE_URL`.
   أسرار الـ Functions (Settings > Variables and Secrets، كـ Secret): `FIREBASE_PROJECT_ID`، `FIREBASE_SERVICE_ACCOUNT` (JSON كامل لـ service account من Firebase)، `CLOUDINARY_CLOUD_NAME`، `CLOUDINARY_API_KEY`، `CLOUDINARY_API_SECRET`، و`SITE_URL`. ماتحطش أي منهم في الكود.
6. `.github/workflows/ci.yml` ملف جديد — الصقه يدويًا.

## الحصص (Firestore Spark)
المصدر الرسمي (firebase.google.com/docs/projects/billing/firebase-pricing-plans): **50,000 قراءة و20,000 كتابة يوميًا**. (حد الحذف 20K ومساحة 1 GiB من مصادر ثانوية — راجعهم في صفحة Firestore quotas.) لما الحصة تخلص العمليات بتترفض والموقع بيعرض رسالة "وصل لحد الاستخدام اليومي".

تقدير التكلفة (من الكود، مش قياس فعلي):
| العملية | قراءات | كتابات |
|---|---|---|
| فتح الموقع (إعدادات + مواقع، كاش جلسة ١٠ دقايق) | 2 | 0 |
| صفحة بحث (حتى ٣ جولات × ٢٤) | ≤ 72 | 0 |
| كشف تواصل جديد | ~6 | 3 |
| مشاهدة (مرة/IP/وحدة/٦ ساعات) | 1 | 1 |
| sitemap (كاش ٦ ساعات) | ≤ 501 | 0 |
**أكبر مخاطرة:** المشاهدات المجهولة بتاكل من حصة الكتابة (٢٠ ألف/يوم). عطّلها من الإعدادات (`تتبع المشاهدات`) لو زادت.

## قرارات صممتها (غيّرها لو عايز)
- **بعد انتهاء مدة الإعلان**: بيتخفى من البحث والصفحات الهبوط، وصفحته بتعرض "لم يعد متاحًا" للزوار (للمعلن والأدمن بتظهر "انتهت المدة")، والكشف بيتمنع (410). الحالة في قاعدة البيانات بتفضل `active` — مفيش cron. الأدمن بيمدد من لوحة الإعلانات.
- تغيير المدة الافتراضية بيسأل لو تطبّقها على الإعلانات الحالية اللي على "الافتراضي" (لحد ٢٠٠ إعلان في المرة) وبيبعت إشعار لكل معلن.
- الأدمن "حذف" إعلان = `status: removed` (soft delete). المعلن "حذف" = حذف فعلي.
- بدل `_redirects` للـ SPA: Pages بتعمل fallback تلقائي لـ `index.html`، و`public/_routes.json` بيحدد الـ Functions على `/api/*` و`/unit/*` و`/rent/*` و`/sitemap.xml` بس.

## المواقع
27 محافظة + 389 مركز/حي من حزمة `egydata` (MIT) — تتولّد بـ `npm run gen:data`. **مفيش قرى** في المصدر، والمستوى التالت (قرية/حي) بيتضاف من لوحة الأدمن، والمعلن يقدر يكتب اسم القرية يدويًا. اكتمال البيانات مقابل التقسيم الإداري الرسمي **ماتقاسش**.

## ملفات تلمسها يدويًا
- `src/i18n/ar.ts` → `contactEmail` (إيميل صفحة تواصل معنا).
- `src/content/landing.ts` → نص محلي حقيقي لكل محافظة (القوالب بتدي عنوان/وصف/أسئلة فقط، النص الفريد لازم يتكتب بإيدك).
- مفيش صورة OG افتراضية للموقع (صور الإعلانات بتتحقن تلقائيًا). ضيف `public/og.png` لو عايز.

## حل المشاكل الشائعة
- **403 permission-denied على `units`**: القواعد مش منشورة. نفّذ `firebase use ejar-masr-5301c && firebase deploy --only firestore:rules,firestore:indexes`.
- **"انتهت الجلسة" أو 401 عند رفع الصور**: افتح `https://ejar-masr.pages.dev/api/health`. كل القيم لازم `true` و`serviceAccount: "ok"` و`projectMatches: true`. لو لأ، صلّح المتغيرات في Cloudflare (Production) وأعد النشر (Redeploy).
- **400 على signInWithPassword**: بريد/كلمة سر غلط، أو Email/Password مش مفعّل في Firebase Authentication.
- تحذير `Cross-Origin-Opener-Policy` مع تسجيل الدخول بجوجل: عادي ومبيأثرش.

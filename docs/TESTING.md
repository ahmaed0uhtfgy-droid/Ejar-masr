# دليل الاختبارات — إيجار مصر

## تشغيل كل حاجة بنفسك

```bash
npm install
npx playwright install chromium         # مرة واحدة (متصفح الاختبار)

npm run typecheck                        # فحص الأنواع (الواجهة + الـ Functions)
npm run lint
npm test                                 # الوحدات + تكامل الـ API (ثواني، من غير إنترنت)
npm run test:coverage                    # نفس الشيء + نسبة التغطية
npm run test:rules                       # قواعد Firestore على الـ emulator (محتاج Java)
npm run build:e2e && npm run test:e2e:emulators   # المتصفح من أوله لآخره على emulators (آمن: بيانات وهمية)
npm run test:all                         # typecheck + lint + test + rules

# اختبارات على الموقع المنشور (قراءة فقط، آمنة على الإنتاج):
BASE_URL=https://ejar-masr1.pages.dev npx playwright test --grep "@public|@deployed" --project=desktop
```
على ويندوز PowerShell: `$env:BASE_URL="https://ejar-masr1.pages.dev"; npx playwright test --grep "@public|@deployed" --project=desktop`

## إيش في كل طبقة

| الطبقة | المكان | بتثبت إيه | محتاج إيه |
|---|---|---|---|
| وحدات (Unit) | `functions/_lib/*.test.ts`، `src/lib/*.test.ts` | حسابات الإيجار والأقساط والتأمين، التحقق من المدخلات، HMAC، escaping، تحويل البيانات | Node بس |
| تكامل الـ API | `functions/_tests/*.test.ts` | كل endpoint بصلاحياته وحالاته الخاطئة ضد قاعدة بيانات وهمية في الذاكرة (مش بياناتك الحقيقية) | Node بس |
| قواعد Firestore | `tests/rules/*.test.ts` | مين يقرأ/يكتب إيه (leases, payments, payout…) | Java + firebase-tools |
| E2E (Playwright) | `e2e/*.spec.ts` | تسجيل، دخول، خروج، نشر وحدة، بحث، كشف التواصل، 404، الصفحات الخاصة، إمكانية الوصول (axe) | emulators + build |
| على الموقع المنشور | `e2e/deployed.spec.ts` | الـ API ترفض الغريب، headers الأمان، robots/sitemap، حقن XSS | `BASE_URL` |
| أداء (k6) | `perf/*.js` | زمن الاستجابة تحت ضغط | k6 (مجاني) — اقرأ `perf/README.md` أول |

### ليه "قاعدة بيانات وهمية" في تكامل الـ API؟
`functions/_tests/fakeFirestore.ts` بتتكلم بنفس صيغة Firestore REST (typed values, runQuery, commit بشروطه) فالـ handlers بتشتغل زي ما هي بدون أي تعديل، وكل اختبار بياخد قاعدة جديدة فاضية.
ده بيغطي منطق الـ API بالكامل بدون أي إعداد. اللي مش بيغطيه: سلوك Firestore الحقيقي (الفهارس، الـ latency) — ده بيتغطى بـ `test:rules` والتجربة على staging.

## الـ CI/CD (GitHub Actions)

الملف: `.github/workflows/ci.yml` — بيشتغل على **كل push وكل pull request**:
`static` (أنواع + lint) ← `unit-integration` ← `rules` ← `e2e` ← `build` ← `security` (npm audit + gitleaks)،
وبعدهم `deploy` ثم `post-deploy-smoke`. لو أي job فشل، الـ deploy ما بيشتغلش.

### منع النشر لو فشل أي اختبار — لازم تختار طريقة (Cloudflare بينشر لوحده افتراضيًا!)
بما إن Cloudflare Pages مربوط بالـ Git، هو بينشر كل push **بغض النظر عن الاختبارات**. اختار واحدة:

**الطريقة A (الأبسط، من غير أي مفاتيح):** Branch protection
1. GitHub → Settings → Branches → Add rule على `main`.
2. فعّل *Require a pull request before merging* و *Require status checks to pass* واختار الـ jobs: `static`, `unit-integration`, `rules`, `e2e`, `build`, `security`.
3. شغّل بـ Pull Requests بس. الكود ما بيوصل `main` (وبالتالي ما بيتنشر) غير بعد ما كل شيء ينجح.

**الطريقة B (النشر من GitHub Actions):**
1. Cloudflare → مشروعك → Settings → Builds → **Branch control** → عطّل *Automatic deployments* للـ production.
2. GitHub → Settings → Secrets and variables → Actions:
   - Secrets: `CLOUDFLARE_API_TOKEN` (صلاحية *Cloudflare Pages: Edit*)، `CLOUDFLARE_ACCOUNT_ID`، `VITE_FIREBASE_API_KEY`، `VITE_FIREBASE_AUTH_DOMAIN`، `VITE_FIREBASE_PROJECT_ID`، `VITE_FIREBASE_APP_ID`
   - Variables: `CLOUDFLARE_PROJECT_NAME`، `SITE_URL` (مثلًا `https://ejar-masr1.pages.dev`)، `ENABLE_ACTIONS_DEPLOY` = `true`
3. متغيرات السيرفر (Paymob, Firebase service account…) تفضل في Cloudflare كما هي.

### فحوصات مجانية دورية على الموقع المنشور
`.github/workflows/live-checks.yml` (كل اثنين + على الطلب): Playwright للقراءة فقط، Lighthouse، OWASP ZAP (فحص سلبي)، k6 smoke.

## مهم قبل ما تشغّل أي اختبار حِمل
حصص الخطة المجانية **يومية**. اختبار ضغط على الموقع الحقيقي ممكن يخلّص حصة اليوم ويوقف الموقع لباقي اليوم. اعمل نسخة staging (مشروع Firebase تاني مجاني + Cloudflare preview).

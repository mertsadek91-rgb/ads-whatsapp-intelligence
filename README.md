<div dir="rtl">

# منصّة تحليل الإعلانات × واتساب

تربط إنفاقك الإعلاني على Meta بما حدث فعلاً في محادثات واتساب، وتجيب عن السؤال
الذي لا تجيب عنه لوحة الإعلانات: **أي إعلان يجلب عملاء مؤهّلين، لا مجرّد محادثات؟**

تعمل مع **أي مجال عمل**. عند أول تشغيل يقرأ النظام موقع شركتك ووصف نشاطك، ويبني
منه قواعد التقييم الخاصة بمجالك — ما هو «العميل المؤهّل» عندك، وما الذي يُعدّ
مخالفة من موظف المبيعات في نشاطك تحديداً — ثم يعرضها عليك للمراجعة قبل تفعيلها.

[English below ↓](#english)

---

## ما الذي يفعله

| | |
|---|---|
| **التنصيب** | معالج من ست خطوات في المتصفّح. كل خطوة تُختبر فعلياً مقابل الخدمة الحقيقية قبل الحفظ، ويشرح لك كل حقل من أين تحصل عليه بالضبط. |
| **الربط** | إعلانات Meta (قراءة فقط) + واتساب عبر Wati.io + الذكاء الاصطناعي عبر DeepSeek. |
| **التحليل** | يقيّم كل محادثة: نيّة العميل، جودة رد الموظف، المخالفات مع اقتباس يثبتها، والخطوة التالية التي وصل إليها العميل. |
| **اللوحات** | مؤشرات الحملات والإعلانات والبلدان، العملاء المؤهّلون، مراجعة الجودة، ولوحات عرض للشاشات. |
| **التقارير** | تقارير يومية وأسبوعية وشهرية بصيغة PDF تُرسل بالبريد تلقائياً. |

## التنصيب

**ما تحتاجه:** Docker، أو Node 20+ مع MySQL 8.0.19 أو أحدث.

<div dir="ltr">

```bash
git clone <repo> && cd <repo>
cp .env.example .env          # يكفي توليد SESSION_SECRET — الباقي من المعالج
docker compose up --build
```

</div>

ثم افتح `http://localhost:3000` — سيستقبلك معالج التنصيب مباشرة.

> عند أول تشغيل يطبع الخادم **رمز تنصيب** في السجل. لست بحاجة إليه إن كنت تفتح
> المتصفّح على نفس الجهاز؛ تحتاجه فقط للتنصيب من جهاز آخر.

### خطوات المعالج

1. **قاعدة البيانات** — يختبر الاتصال فعلياً، ويعرض زر «أنشئها لي» إن لم تكن موجودة، ثم يُنشئ كل الجداول.
2. **إعلانات Meta** — يتحقّق من الرمز والصلاحيات، ثم يعرض قائمة حساباتك الإعلانية لتختار منها بدل أن تبحث عن رقم.
3. **واتساب (Wati)** — يصحّح العنوان تلقائياً إن نقصه رقم المستأجر، ويعرض أرقام واتساب المتصلة وعدد جهات الاتصال.
4. **الذكاء الاصطناعي** — يتحقّق من المفتاح ومن وجود رصيد (وهما خطآن مختلفان)، ويعرض النماذج المتاحة.
5. **تعريف نشاطك** — رابط موقعك + وصف نشاطك. يقرأ النظام موقعك ويبني ملف التقييم، ثم **يعرضه عليك للمراجعة**.
6. **الحساب والبيانات** — بريدك وكلمة مرورك، ثم **من أي تاريخ نسحب البيانات**: كل
   المتاح، أو من يوم تختاره، مع خيار سحب نصّ محادثات واتساب. ينتهي التنصيب، ويبدأ
   الاستيراد فوراً في الخلفية بلا إعادة تشغيل.

كل خطوة فيها زر **«من أين أحصل على هذا؟»** يشرح بالتفصيل — أي صفحة في لوحة Meta،
وأين رمز Wati، ولماذا لا يعمل مفتاح DeepSeek بلا رصيد، وأوامر SQL الجاهزة لإنشاء
مستخدم قاعدة بيانات.

## مدى البيانات

سؤال واحد — «من متى تريد البيانات؟» — خلفه مصدران مختلفان تماماً:

- **Meta** يحتفظ بنحو 37 شهراً من بيانات الإعلانات. «كل المتاح» تعني ذلك فعلياً؛
  طلب تاريخ أقدم لا يعطي شيئاً إضافياً.
- **واتساب (Wati)** لا يوفّر فلترة بالتاريخ في قائمة جهات الاتصال إطلاقاً، فتُقرأ
  القائمة كاملة دائماً. التاريخ يحدّ الجزء المكلف فقط: **لأي جهات اتصال نسحب نصّ
  المحادثة** — طلب منفصل لكل جهة اتصال، وهو أبطأ جزء في العملية بفارق كبير.

بدون سحب نصّ المحادثات لن يُقيَّم أي حوار — سيكون لديك جهات اتصال وحملات فقط.
غيّر المدى لاحقاً من **الإعدادات ← مدى البيانات المستوردة**؛ الحفظ وحده لا يجلب
شيئاً، فاضغط «استورد الآن» لملء الفترة الإضافية.

## مراجعة ملف نشاطك

هذه أهم خطوة، ولا تتخطّها: ملف نشاطك يحدّد كيف ستُقيَّم كل محادثة بعد اليوم.

- **المعلومات المعتمدة** تظهر أولاً، وبجانب كل واحدة الاقتباس الحرفي من موقعك
  الذي بُنيت عليه. أي معلومة لم يستطع النظام اقتباسها تُعلَّم «غير مؤكَّدة»
  وتحتاج تأكيدك — **واحدة واحدة**، لأن معلومة خاطئة هنا تجعل التقييم خاطئاً في
  الاتجاهين.
- **درجة خطورة كل مخالفة** قابلة للتعديل، لأنها تؤثّر مباشرة على تقييم الموظف.
- **الوسوم** يظهر بجانب كل مجموعة من يملك حقيقتها: الذكاء الاصطناعي، أم حساب
  دقيق من بياناتنا، أم **نظام آخر لن يخمّنه الذكاء الاصطناعي أبداً**.

## الأمان

- صلاحيات حقيقية: مدير / مشرف عمليات / اطّلاع فقط. المسارات التي تُنفق مالاً
  (الحملات الجماعية) أو تغيّر الإعدادات محميّة فعلياً، لا في الواجهة فقط.
- كل بيانات الاعتماد مشفّرة في قاعدة البيانات (AES-256-GCM)، والمفتاح خارجها.
- قراءة موقعك محميّة ضد العناوين الداخلية، فلا يمكن استخدام النظام للوصول إلى
  شبكتك الداخلية.
- كلمات المرور مُلبّدة بـ bcrypt، مع حدّ للمحاولات وسجلّ دخول.

## ملاحظة صريحة

بُني هذا النظام أصلاً لشركة وساطة مالية، وبقيت بعض أسماء الأعمدة في قاعدة
البيانات على مفردات ذلك المجال (`deposit_flag`، `account_type`، والأعمدة
المنتهية بـ `_aed`). المفاهيم تُترجم عبر ملف نشاطك وتظهر لك بمفردات مجالك،
لكن أسماء الأعمدة نفسها لم تتغيّر بعد. هذا معروف وموثَّق، وليس مفاجأة.

كذلك: العملة الأساسية تُؤخذ حالياً من حساب Meta دون تحويل، وخريطة مفاتيح
الهواتف لا تزال تخلط كندا بأمريكا وكازاخستان بروسيا. كلاهما مُدرج للإصلاح
ومذكور هنا حتى لا تكتشفه في تقرير.

</div>

---

<a name="english"></a>

# Ads × WhatsApp Intelligence

Joins your Meta ad spend to what actually happened in the WhatsApp conversations
it produced, and answers the question the ads dashboard cannot: **which ad brings
qualified customers, not just conversations?**

It works for **any industry**. On first run it reads your company's website and
your description of the business, builds the evaluation rules for your field —
what a qualified lead means for you, what counts as a violation by a salesperson
in your business — and shows them to you for review before anything goes live.

## What it does

| | |
|---|---|
| **Install** | A six-step browser wizard. Every step is tested against the real service before it is saved, and every field explains exactly where to get its value. |
| **Connects** | Meta Ads (read-only) + WhatsApp via Wati.io + AI via DeepSeek. |
| **Analyses** | Scores every conversation: customer intent, agent quality, compliance findings with a quote as evidence, and the next step the customer actually reached. |
| **Boards** | Campaign, ad and country metrics, qualified leads, quality review, and wall displays. |
| **Reports** | Daily, weekly and monthly PDFs, emailed automatically. |

## Installing

**You need** Docker, or Node 20+ with MySQL 8.0.19 or newer.

```bash
git clone <repo> && cd <repo>
cp .env.example .env          # generating SESSION_SECRET is enough — the wizard does the rest
docker compose up --build
```

Then open `http://localhost:3000`. The installation wizard meets you there.

> On first start the server prints an **install token** to its log. You do not
> need it when installing from the same machine — only from a different one.

### The six steps

1. **Database** — really tests the connection, offers a "create it for me" button when the schema does not exist, then creates every table.
2. **Meta Ads** — verifies the token and its scopes, then lists your ad accounts so you pick one instead of hunting for a number.
3. **WhatsApp (Wati)** — corrects the endpoint automatically when the tenant id is missing, and shows your connected WhatsApp numbers and contact count.
4. **AI** — tells a bad key apart from a key with no credit (a different problem with a different fix) and lists the available models.
5. **Your business** — website URL plus a description. The system reads your site, builds the evaluation profile, and **shows it to you for review**.
6. **Account & data** — your email and password, then **how far back to import**:
   everything available, or from a date you pick, with an option to pull the
   WhatsApp conversation text too. Setup completes, the first import starts in
   the background, and the app is running with no restart.

Every field has a **"Where do I get this?"** panel: which page of the Meta App
Dashboard holds the App Secret, where the Wati token lives, why a DeepSeek key
fails without credit, and the literal SQL to create a database user.

## How much history to import

One question — "since when do you want data?" — sits on top of two very
different sources:

- **Meta** retains about 37 months of ad insights. "Everything available" means
  exactly that; asking for an older date returns nothing extra.
- **Wati** offers no date filter on the contact list at all, so the list is
  always read whole. The date bounds the expensive half only: **which contacts
  we pull the message thread for** — one request each, and by far the slowest
  part of an import.

Without the message text nothing gets scored: you have contacts and campaigns
and no conversations. Change the range later under **Settings → How much
history to import**; saving alone fetches nothing, so press "Import now" to
fill in the extra period.

## Reviewing your business profile

Do not skip this step. The profile decides how every conversation is judged.

- **Company facts** come first, each showing the verbatim sentence from your site
  it was based on. Anything the system could not quote is marked **unverified**
  and needs your confirmation — **one at a time**, because a wrong fact here
  makes the evaluation wrong in both directions.
- **Issue severities** are editable, because severity drives an agent's score.
- **Tags** show who owns each category's truth: the AI, an exact computation, or
  **another system, which the AI will never guess**.

## Security

- Real roles: admin / manager / viewer. The routes that spend money (broadcasts)
  or change configuration are actually gated, not merely hidden in the UI.
- Every credential is encrypted at rest (AES-256-GCM) with the key held outside
  the database.
- The website reader refuses private and loopback addresses, so the installer
  cannot be turned into a probe of your internal network.
- Passwords are bcrypt-hashed, with rate limiting and a login audit trail.

## Stated plainly

This was originally built for a financial brokerage, and some database column
names still carry that industry's vocabulary (`deposit_flag`, `account_type`,
and the `_aed`-suffixed columns). The concepts are translated through your
business profile and you see your own words in the UI, but the column names
themselves have not been renamed yet. That is known and documented, not a
surprise waiting for you.

Likewise: the base currency is currently taken from your Meta account without
conversion, and the phone-prefix map still folds Canada into the US and
Kazakhstan into Russia. Both are queued for fixing and named here so you do not
discover them in a report.

## Development

On Windows use `cd /d` and one command per line — `cd` combined with `&&`
across drives does not work in cmd.

```bat
cd /d <repo>\server
npm ci
npm test
```

807 server tests and 106 web tests. See QUICKSTART.md for the full run-through.

| Path | What it is |
|---|---|
| `server/src/setup/` | Wizard validators and the bilingual error guidance. |
| `server/src/profiles/` | `generic.js` is the seed; `brokerage.js` is a worked example. |
| `server/src/lib/businessProfile.js` | Profile storage, versioning and the re-analysis fingerprint. |
| `web/src/setup/` | The wizard UI and its per-field help content. |
| `server/scripts/legacy/` | One-off historical scripts. Not supported — read before running. |

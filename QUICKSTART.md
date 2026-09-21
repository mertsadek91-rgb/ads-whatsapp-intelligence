# التشغيل السريع · Quick start

<div dir="rtl">

> **ملاحظة للويندوز:** الأوامر أدناه مكتوبة لـ **cmd** و **PowerShell**.
> في cmd لا تستخدم `&&` مع `cd` عبر أقراص مختلفة — استخدم `cd /d`.
> وكل سطر أمر واحد، لا تلصق سطرين معاً.

## الطريقة الأولى: تشغيل محلي (الأسرع للتجربة)

تحتاج **Node 20+** و**MySQL 8.0.19+** تعمل بالفعل.

**الخطوة 1** — ثبّت الحزم (مرّة واحدة فقط):

</div>

```bat
cd /d D:\Cloude\Wati-Ads-Reporter-Clean\server
```

```bat
npm ci
```

<div dir="rtl">

**الخطوة 2** — ابنِ الواجهة (مرّة واحدة فقط):

</div>

```bat
cd /d D:\Cloude\Wati-Ads-Reporter-Clean\web
```

```bat
npm ci
```

```bat
npm run build
```

<div dir="rtl">

**الخطوة 3** — شغّل:

</div>

```bat
cd /d D:\Cloude\Wati-Ads-Reporter-Clean\server
```

```bat
npm start
```

<div dir="rtl">

ثم افتح **http://localhost:3000** — سيستقبلك معالج التنصيب مباشرة.

**لا تحتاج ملف `.env` إطلاقاً** في هذه الطريقة: المعالج يسأل عن كل شيء، ويولّد
مفاتيح الأمان بنفسه ويحفظها في `server\data\setup.json`.

لإيقاف الخادم: اضغط `Ctrl + C` في نفس النافذة.

لتشغيله على منفذ آخر إن كان 3000 مشغولاً:

</div>

```bat
set PORT=3100 && npm start
```

<div dir="rtl">

---

## الطريقة الثانية: Docker

تشغّل قاعدة البيانات والتطبيق معاً، لكنها تتطلّب أن يكون **محرّك Docker يعمل فعلاً**.

إن ظهر لك هذا الخطأ:

</div>

```
open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified
```

<div dir="rtl">

فالمحرّك لم يبدأ بعد. الحل:

1. افتح **Docker Desktop** من قائمة ابدأ.
2. انتظر حتى تتحوّل أيقونة الحوت في شريط المهام إلى **أخضر/ثابت** وتقول *Engine running*.
3. أول مرّة قد يطلب الموافقة على الشروط أو تسجيل الدخول — أكمل ذلك.
4. تحقّق بأمر:

</div>

```bat
docker info
```

<div dir="rtl">

فإن نجح، شغّل:

</div>

```bat
cd /d D:\Cloude\Wati-Ads-Reporter-Clean
```

```bat
copy .env.example .env
```

<div dir="rtl">

ثم افتح `.env` وعدّل ثلاثة أسطر فقط:

</div>

```
SESSION_SECRET=<الصق الناتج من الأمر التالي>
MYSQL_PASSWORD=<كلمة مرور قوية>
MYSQL_URL=mysql://app:<نفس كلمة المرور>@mysql:3306/ads_whatsapp
```

<div dir="rtl">

لتوليد `SESSION_SECRET`:

</div>

```bat
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

<div dir="rtl">

ثم:

</div>

```bat
docker compose up --build
```

<div dir="rtl">

---

## ما ستحتاجه أثناء المعالج

| الخطوة | ما تحتاجه | المعالج يشرح من أين تحصل عليه |
|---|---|---|
| قاعدة البيانات | مضيف، مستخدم، كلمة مرور، اسم القاعدة | ✅ مع أوامر SQL جاهزة |
| Meta | App ID، App Secret، رمز وصول بصلاحية `ads_read` | ✅ خطوة بخطوة |
| Wati | عنوان الـ API ورمز الوصول | ✅ ويصحّح العنوان تلقائياً |
| الذكاء الاصطناعي | مفتاح DeepSeek **مع رصيد** | ✅ ويفرّق بين مفتاح خاطئ ورصيد صفر |
| نشاطك | رابط موقعك + وصف من 3–5 أسطر | أهم خطوة — منها يتعلّم النظام مجالك |
| المدير | بريدك وكلمة مرور (10 أحرف على الأقل) | — |

**لا يمكنك تخطّي أي خطوة بدون اختبار ناجح فعلي** — هذا مقصود.

---

## تجربة بدون حسابات حقيقية؟

يمكنك إكمال خطوة قاعدة البيانات فقط ورؤية المعالج يعمل، لكن الخطوات التالية
تتطلّب بيانات حقيقية لأنها تختبرها فعلياً مقابل الخدمات. لا توجد بيانات وهمية —
وهذا متعمّد: تنصيب ينتهي ببيانات لم يتحقّق منها أحد ليس تنصيباً ناجحاً.

## للتحقّق من أن كل شيء سليم قبل التجربة

</div>

```bash
cd server && npm test        # 807 اختبار
cd ../web  && npm test       # 106 اختبار
```

<div dir="rtl">

ولاختبار تنصيب حقيقي كامل مقابل قاعدة بيانات مؤقّتة:

</div>

```bash
docker run -d --name mysql-test -e MYSQL_ROOT_PASSWORD=rootpw \
  -e MYSQL_DATABASE=install_test -p 33061:3306 mysql:8.4

cd server
TEST_MYSQL_URL="mysql://root:rootpw@127.0.0.1:33061/install_test" npm run test:integration

docker rm -f mysql-test
```

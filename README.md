# شركة وادي بناء للنقل الدولي — دليل التشغيل

## مكونات التطبيق

- `index.html` والصفحات المنفردة تعرض النظام؛ `assets/js/module-shell.js` يحمّل واجهات الأقسام من `assets/fragments/`.
- `assets/fragments/` تحتوي واجهات لوحة التحكم والرحلات والركاب والشحن والعبور والسائقين والموظفين والمالية والمستخدمين؛ وتنسّق `assets/css/app.css` المظهر والطباعة.
- `assets/js/app.js` يستخدم Firebase Authentication للبريد وكلمة المرور، وRealtime Database للبيانات وملفات الصلاحيات.
- `assets/js/firebase-config.js` و`.firebaserc` يحددان إعدادات مشروع Firebase. تحقق من تطابقهما قبل النشر.
- `firebase.database.rules.json` يرفض الوصول افتراضياً، ويتحقق من حالة الحساب ودوره وفرعه من `users/{uid}` في كل طلب، ويشترط أن ينتهي بريد المستخدم بـ`@swd.ae`. يوجد استثناء UID محدد لحساب المالك الحالي ذي البريد الشخصي.
- إنشاء حسابات المصادقة وكلمات المرور وإيقافها يتم في Firebase Console. لوحة النظام تربط UID بحقول الدور والفرع فقط؛ لا تحفظ كلمات المرور.
- صفحة استعادة كلمة المرور ترسل رابط Firebase Auth إلى البريد، وتُخزّن التذاكر بمفتاح معرّف التذكرة حتى تتحقق قواعد Realtime Database من وجودها قبل تسجيل الصعود مرة واحدة.
- لا يعتمد النشر الحالي على Cloud Functions. مجلد `functions/` مصدر قديم غير مضاف إلى `firebase.json`، فلا تنشره أو تعتمد عليه.

## التشغيل المحلي والنشر

1. ثبّت Node.js 20 أو أحدث، وشغّل `npm start` ثم افتح `http://127.0.0.1:8000/`. لا تفتح الصفحات من `file://`. يعتمد الخادم المحلي على Node.js فقط؛ مكتبات الواجهة تُحمّل من CDN.
2. في Firebase Console للمشروع المحدد، فعّل Authentication > Email/Password، وأنشئ حسابات الموظفين ببريد الشركة المنتهي بـ`@swd.ae`. فعّل Realtime Database وأضف نطاق التطبيق إلى Authentication > Settings > Authorized domains (ومنها `localhost` للتطوير و`wadibena.github.io` عند استخدام GitHub Pages).
3. أنشئ حساب المالك في Authentication، ثم انسخ UID الخاص به. قبل نشر القواعد الجديدة، أضف في Realtime Database ملف `users/{UID}` للمالك، بالحقول `email`, `username`, `fullName`, `role: "owner"`, `branchId: "all"`, `active: true`, `hidden: false`, و`phone`.
4. خذ نسخة احتياطية من قاعدة البيانات وتحقق من UID ودور وفرع حساب المالك. بعد ذلك انشر القواعد فقط: `firebase deploy --only database`. نشر القواعد قبل إنشاء ملف المالك قد يمنع جميع الحسابات من الدخول.
5. أنشئ حسابات الموظفين في Firebase Console > Authentication، ثم استخدم لوحة «ملفات الصلاحيات» لإدخال UID والبريد والدور والفرع. حذف ملف الصلاحيات يوقف وصول الحساب إلى بيانات التطبيق، لكنه لا يحذف حساب Firebase Authentication.
6. يستطيع المستخدم تغيير كلمة مروره من داخل النظام أو طلب رابط إعادة تعيين عبر البريد. لاستخدام الروابط، أضف نطاق الموقع إلى قائمة النطاقات المسموحة في Firebase Authentication.

## الحسابات والبيانات المستوردة سابقاً

ملفات المستخدمين التي أُنشئت قبل اعتماد Firebase Authentication قد تحتوي UIDs مولّدة محلياً؛ هذه ليست UIDs لحسابات Authentication ولا تسمح بتسجيل الدخول. أنشئ الحسابات بالبريد في Firebase Console ثم اربط كل UID حقيقي بملف صلاحيات. بيانات `authCredentials` و`usernameIndex` القديمة غير مستخدمة وممنوع الوصول إليها بالقواعد؛ بعد أخذ نسخة احتياطية، احذفها من Realtime Database عبر Firebase Console. لا تعِد استخدام كلمات المرور القديمة أو ملفاتها الخاصة.

تُخزّن بيانات الركاب في Realtime Database بمفاتيح معرّفات التذاكر الصالحة والفريدة حتى تتمكن القواعد من التحقق من وجود التذكرة قبل تسجيل الصعود. أي بيانات ركاب قديمة محفوظة كمصفوفات تتحول إلى هذا الشكل عند مزامنة حفظ جديدة من التطبيق؛ تأكد من نجاح المزامنة قبل تشغيل قارئ الباركود، وصحح أي أرقام مكررة أو غير صالحة قبل تسجيل صعودها.

## إعداد GitHub Pages

يُنشر التطبيق على `https://wadibena.github.io/wadibana.ae/` عبر `.github/workflows/static.yml`. اختر «GitHub Actions» مصدراً للنشر في إعدادات Pages بالمستودع. أضف النطاق `wadibena.github.io` إلى Authorized domains في Firebase Authentication.

إعداد Firebase للويب، بما فيه `apiKey`، ظاهر للمتصفح وليس سراً؛ لا تضع Database Secret أو Service Account أو كلمات المرور أو نسخ قاعدة البيانات في JavaScript أو المستودع. الحماية تعتمد على Authentication وقواعد قاعدة البيانات، وليس على إخفاء هذا المفتاح.

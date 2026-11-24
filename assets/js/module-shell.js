window.firebaseConfig = {
    apiKey: "AIzaSyCX0AnjNnffeRCFGDugKeOI8k8adJC1aqs",
    authDomain: "wadi-bana-b585b.firebaseapp.com",
    databaseURL: "https://wadi-bana-b585b-default-rtdb.firebaseio.com",
    projectId: "wadi-bana-b585b",
    storageBucket: "wadi-bana-b585b.firebasestorage.app",
    messagingSenderId: "57806694102",
    appId: "1:57806694102:web:8b2f38f1b86c0240290b77",
    measurementId: "G-DR3Y513XP9"
};

async function loadModulePage() {
    const moduleName = document.body.dataset.module;
    await import('./app.js');

    if (moduleName === 'login') return;

    const moduleHost = document.getElementById('moduleHost');
    if (!moduleHost) {
        throw new Error('تعذر العثور على مساحة عرض الأقسام.');
    }

    const fragmentAliases = {
        finance: 'financials',
        'driver-accounts': 'drivers',
        'payroll-employees': 'salaries'
    };
    const appModules = [
        'dashboard',
        'buses',
        'trips',
        'passengers',
        'cargo',
        'transit',
        'driver-accounts',
        'payroll-employees',
        'finance',
        'users'
    ];
    const requestedModules = moduleName ? [moduleName] : appModules;
    const modalHost = document.getElementById('sharedModals');
    const responses = await Promise.all([
        ...(modalHost ? [fetch('assets/fragments/common-modals.html')] : []),
        ...requestedModules.map(name => fetch(`assets/fragments/${name}.html`))
    ]);
    if (responses.some(response => !response.ok)) {
        throw new Error('تعذر تحميل عناصر الصفحة المطلوبة.');
    }

    const modalResponseCount = modalHost ? 1 : 0;
    if (modalHost) {
        modalHost.innerHTML = await responses[0].text();
    }
    const moduleMarkup = await Promise.all(
        responses.slice(modalResponseCount).map(response => response.text())
    );
    moduleHost.innerHTML = moduleMarkup.join('\n');

    const activeModule = fragmentAliases[moduleName] || moduleName || 'dashboard';
    moduleHost.querySelectorAll('.tab-content').forEach(section => {
        section.classList.toggle('hidden', section.id !== `module-${activeModule}`);
    });
    document.dispatchEvent(new CustomEvent('wadi:module-ready'));
}

loadModulePage()
    .catch(error => {
        console.error(error);
        const host = document.getElementById('moduleHost');
        if (host) host.innerHTML = `<div class="bg-cardbg border border-red-700 p-5 rounded-2xl text-red-300 text-sm">تعذر تحميل محتوى الصفحة. يرجى إعادة المحاولة.</div>`;
    });
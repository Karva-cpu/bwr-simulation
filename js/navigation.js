const Nav = {
    currentView: 'MAIN', // 'MAIN' or 'ECCS'

    setView: function (view) {
        this.currentView = view;

        const mcr = document.getElementById('main-console');
        const eccs = document.getElementById('eccs-console');

        if (view === 'ECCS') {
            mcr.classList.remove('panel-visible');
            mcr.classList.add('panel-hidden');
            eccs.classList.remove('panel-hidden');
            eccs.classList.add('panel-visible');
        } else {
            eccs.classList.remove('panel-visible');
            eccs.classList.add('panel-hidden');
            mcr.classList.remove('panel-hidden');
            mcr.classList.add('panel-visible');
        }

    }
};

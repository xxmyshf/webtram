export interface SessionTabInfo {
  id: string;
  title: string;
  active: boolean;
  hasUnread: boolean;
}

export interface SessionTabBarCallbacks {
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  onCloseSession: (id: string) => void;
  onRenameSession: (id: string, newTitle: string) => void;
}

export class SessionTabBar {
  private container: HTMLElement;
  private tabsScroll: HTMLElement;
  private addBtn: HTMLButtonElement;
  private tabs: SessionTabInfo[] = [];
  private callbacks: SessionTabBarCallbacks;
  private isRenaming = false;

  constructor(callbacks: SessionTabBarCallbacks) {
    this.callbacks = callbacks;

    this.container = document.createElement('div');
    this.container.className = 'cyber-tab-bar';

    this.tabsScroll = document.createElement('div');
    this.tabsScroll.className = 'tab-list-scroll';

    this.addBtn = document.createElement('button');
    this.addBtn.type = 'button';
    this.addBtn.className = 'tab-add-btn';
    this.addBtn.title = '新建终端 (Alt+T)';
    this.addBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    `;

    this.container.appendChild(this.tabsScroll);
    this.container.appendChild(this.addBtn);

    this.initEvents();
  }

  private initEvents(): void {
    this.addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onCreateSession();
    });

    // Horizontal wheel scroll for mouse users
    this.tabsScroll.addEventListener('wheel', (e) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        this.tabsScroll.scrollLeft += e.deltaY;
      }
    }, { passive: false });

    // Keyboard shortcuts: Alt+1..9, Alt+T, Alt+W
    window.addEventListener('keydown', (e) => {
      // Don't trigger if user is renaming or inside modal input
      if (this.isRenaming) return;
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && !target.classList.contains('xterm-helper-textarea')) {
        return;
      }

      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.key >= '1' && e.key <= '9') {
          const index = parseInt(e.key, 10) - 1;
          if (index < this.tabs.length) {
            e.preventDefault();
            this.callbacks.onSelectSession(this.tabs[index].id);
          }
        } else if (e.key === 't' || e.key === 'T') {
          e.preventDefault();
          this.callbacks.onCreateSession();
        } else if (e.key === 'w' || e.key === 'W') {
          e.preventDefault();
          const activeTab = this.tabs.find(t => t.active);
          if (activeTab) {
            this.callbacks.onCloseSession(activeTab.id);
          }
        }
      }
    });
  }

  public setTabs(tabs: SessionTabInfo[]): void {
    this.tabs = [...tabs];
    this.render();
  }

  public getTabs(): SessionTabInfo[] {
    return this.tabs;
  }

  public updateTab(id: string, partial: Partial<SessionTabInfo>): void {
    const tab = this.tabs.find(t => t.id === id);
    if (!tab) return;
    Object.assign(tab, partial);
    this.render();
  }

  public setActiveTab(id: string): void {
    let changed = false;
    for (const t of this.tabs) {
      const wasActive = t.active;
      t.active = t.id === id;
      if (t.active && t.hasUnread) {
        t.hasUnread = false;
        changed = true;
      }
      if (wasActive !== t.active) {
        changed = true;
      }
    }
    if (changed) {
      this.render();
    }
  }

  public setUnread(id: string, hasUnread: boolean): void {
    const tab = this.tabs.find(t => t.id === id);
    if (tab && !tab.active && tab.hasUnread !== hasUnread) {
      tab.hasUnread = hasUnread;
      this.render();
    }
  }

  public getElement(): HTMLElement {
    return this.container;
  }

  private render(): void {
    if (this.isRenaming) return; // Wait until rename is done to re-render DOM

    this.tabsScroll.innerHTML = '';

    this.tabs.forEach((tab, index) => {
      const tabEl = document.createElement('div');
      tabEl.className = `cyber-tab${tab.active ? ' active' : ''}${tab.hasUnread ? ' has-unread' : ''}`;
      tabEl.setAttribute('data-id', tab.id);
      tabEl.title = `${tab.title} (Alt+${index + 1})\n双击可重命名`;

      // 1. Index badge
      const indexEl = document.createElement('span');
      indexEl.className = 'tab-index';
      indexEl.textContent = `${index + 1}:`;

      // 2. Title text
      const titleEl = document.createElement('span');
      titleEl.className = 'tab-title';
      titleEl.textContent = tab.title || `term-${index + 1}`;

      // 3. Activity Dot
      const dotEl = document.createElement('span');
      dotEl.className = 'tab-activity-dot';

      // 4. Close Button
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'tab-close-btn';
      closeBtn.title = '关闭终端 (Alt+W)';
      closeBtn.innerHTML = '&times;';

      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onCloseSession(tab.id);
      });

      tabEl.appendChild(indexEl);
      tabEl.appendChild(titleEl);
      tabEl.appendChild(dotEl);
      tabEl.appendChild(closeBtn);

      // Click to select
      tabEl.addEventListener('click', () => {
        if (this.isRenaming) return;
        this.callbacks.onSelectSession(tab.id);
      });

      // Double-click to rename
      tabEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.startRename(tab, tabEl, titleEl);
      });

      this.tabsScroll.appendChild(tabEl);

      if (tab.active) {
        requestAnimationFrame(() => {
          tabEl.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
        });
      }
    });
  }

  private startRename(tab: SessionTabInfo, tabEl: HTMLElement, titleEl: HTMLElement): void {
    this.isRenaming = true;
    tabEl.classList.add('renaming');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tab-rename-input';
    input.value = tab.title;
    input.maxLength = 20;

    titleEl.style.display = 'none';
    tabEl.insertBefore(input, titleEl.nextSibling);

    input.focus();
    input.select();

    const commit = () => {
      if (!this.isRenaming) return;
      this.isRenaming = false;
      const newTitle = input.value.trim() || tab.title;
      tab.title = newTitle;
      this.callbacks.onRenameSession(tab.id, newTitle);
      this.render();
    };

    const cancel = () => {
      if (!this.isRenaming) return;
      this.isRenaming = false;
      this.render();
    };

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        commit();
      } else if (e.key === 'Escape') {
        cancel();
      }
    });

    input.addEventListener('blur', () => {
      commit();
    });
  }
}

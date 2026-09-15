import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { ChatbotService } from '../../services/chatbot.service';
import { ChatbotUiService } from '../../services/chatbot-ui.service';
import { CartService } from '../../services/cart.service';
import { ChatbotQuickReply } from '../../models/interfaces';

const CLOSE_MS = 260;
const DRAG_THRESHOLD_PX = 6;
const BUBBLE_SIZE = 58;
const EDGE_MARGIN = 4;
const REMOVE_DROP_RADIUS_PX = 55;

/** Matches cart.scss's breakpoint - at or below it the cart page pins its checkout bar to the
 * bottom of the screen, above the bottom navigation. */
const NARROW_VIEWPORT_QUERY = '(max-width: 900px)';

/** Just clear of the cart page's checkout bar. Built from the same two tokens that place the bar
 * itself, so it follows them - and the iPhone home-indicator inset - if either ever changes. */
const ABOVE_CART_BAR = 'calc(var(--ojas-bottom-nav-clearance) + var(--ojas-cart-bar-h) + 10px)';

interface ChatMessage {
  from: 'bot' | 'user';
  text: string;
  quickReplies?: ChatbotQuickReply[];
  escalate?: boolean;
}

/**
 * A scripted (not LLM) support widget: every reply comes straight from the backend, which only
 * ever answers from live data or fixed, business-approved text. There is no free-text input -
 * the bot can only ever say things it's actually prepared to answer, so every turn is a
 * quick-reply button the backend itself generated.
 *
 * Open/removed/position state lives in ChatbotUiService, shared with other entry points (the
 * hamburger menu, My Orders) - this component is the one place in the app it's rendered.
 */
@Component({
  selector: 'app-chatbot-widget',
  imports: [],
  templateUrl: './chatbot-widget.html',
  styleUrl: './chatbot-widget.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatbotWidget {
  private readonly chatbot = inject(ChatbotService);
  private readonly router = inject(Router);
  private readonly cart = inject(CartService);
  readonly ui = inject(ChatbotUiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly messagesEl = viewChild<ElementRef<HTMLDivElement>>('messagesEl');
  private readonly removeTargetEl = viewChild<ElementRef<HTMLDivElement>>('removeTargetEl');

  readonly closing = signal(false);
  readonly messages = signal<ChatMessage[]>([]);
  readonly busy = signal(false);
  readonly showRemoveTarget = signal(false);
  readonly nearRemoveTarget = signal(false);
  // A few auth/onboarding screens are meant to be distraction-free - the bubble hides there
  // entirely, panel included, rather than floating over the Turnstile widget or the form.
  readonly hiddenOnRoute = signal(this.isHiddenRoute(this.router.url));

  readonly onCartRoute = signal(this.isCartRoute(this.router.url));
  readonly narrowViewport = signal(
    typeof window !== 'undefined' && !!window.matchMedia?.(NARROW_VIEWPORT_QUERY).matches,
  );
  /** Set once the customer drags the bubble themselves. From then on it stays where they put it,
   * on the cart page too. */
  private readonly movedByCustomer = signal(false);

  /**
   * On a phone, the cart page pins its "Proceed to Checkout" bar just above the bottom navigation -
   * exactly where the bubble sits by default, so it covered the end of the button. There, and only
   * there, the bubble moves up to sit clear of the bar. Every other page keeps the usual spot.
   */
  readonly liftedAboveCartBar = computed(
    () =>
      this.onCartRoute() &&
      this.narrowViewport() &&
      this.cart.items().length > 0 &&
      !this.movedByCustomer(),
  );

  readonly bubbleBottom = computed(() =>
    this.liftedAboveCartBar() ? ABOVE_CART_BAR : `${this.ui.position().bottom}px`,
  );

  private hasStarted = false;
  private readonly timers: ReturnType<typeof setTimeout>[] = [];

  private dragStart: { pointerX: number; pointerY: number; right: number; bottom: number } | null = null;
  private dragMoved = false;
  private lastPointer = { x: 0, y: 0 };

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => {
        this.hiddenOnRoute.set(this.isHiddenRoute(event.urlAfterRedirects));
        this.onCartRoute.set(this.isCartRoute(event.urlAfterRedirects));
      });

    if (typeof window !== 'undefined' && window.matchMedia) {
      const query = window.matchMedia(NARROW_VIEWPORT_QUERY);
      const onChange = (event: MediaQueryListEvent) => this.narrowViewport.set(event.matches);
      query.addEventListener('change', onChange);
      this.destroyRef.onDestroy(() => query.removeEventListener('change', onChange));
    }

    // Whatever opened the panel - the bubble itself, the hamburger menu, or My Orders - this is
    // where the very first greeting gets requested, exactly once per page session.
    effect(() => {
      if (!this.ui.open() || this.hasStarted) return;
      this.hasStarted = true;
      this.request(undefined);
    });

    // Scroll to the newest message whenever the thread changes.
    effect(() => {
      this.messages();
      const el = this.messagesEl()?.nativeElement;
      if (!el) return;
      this.timers.push(setTimeout(() => (el.scrollTop = el.scrollHeight), 0));
    });

    this.destroyRef.onDestroy(() => this.timers.forEach(clearTimeout));
  }

  close(): void {
    if (this.closing()) return;
    this.closing.set(true);
    this.timers.push(
      setTimeout(() => {
        this.ui.closeChat();
        this.closing.set(false);
      }, CLOSE_MS),
    );
  }

  sendQuickReply(reply: ChatbotQuickReply): void {
    if (this.busy()) return;
    this.messages.update((all) => [...all, { from: 'user', text: reply.label }]);
    this.request(reply.topic);
  }

  // --- Drag-to-reposition + drag-to-remove, unified over pointer events (mouse and touch
  // alike). A short tap with negligible movement opens/closes the panel; movement past the
  // threshold is a drag, which immediately surfaces a drop-to-remove target at the bottom
  // center of the screen for as long as the drag continues. ---

  onBubblePointerDown(event: PointerEvent): void {
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    // Lifted above the cart bar, the bubble is not where the stored position says it is - so a
    // drag starts from where it actually sits on screen, or it would jump down under the finger.
    const pos = this.liftedAboveCartBar() ? renderedPosition(event) : this.ui.position();
    this.dragStart = { pointerX: event.clientX, pointerY: event.clientY, right: pos.right, bottom: pos.bottom };
    this.dragMoved = false;
    this.lastPointer = { x: event.clientX, y: event.clientY };
  }

  onBubblePointerMove(event: PointerEvent): void {
    if (!this.dragStart) return;
    this.lastPointer = { x: event.clientX, y: event.clientY };

    const dx = event.clientX - this.dragStart.pointerX;
    const dy = event.clientY - this.dragStart.pointerY;

    if (!this.dragMoved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      this.dragMoved = true;
      this.movedByCustomer.set(true);
      this.showRemoveTarget.set(true);
    }

    if (this.dragMoved) {
      const maxRight = window.innerWidth - BUBBLE_SIZE - EDGE_MARGIN;
      const maxBottom = window.innerHeight - BUBBLE_SIZE - EDGE_MARGIN;
      this.ui.setPosition({
        right: clamp(this.dragStart.right - dx, EDGE_MARGIN, maxRight),
        bottom: clamp(this.dragStart.bottom - dy, EDGE_MARGIN, maxBottom),
      });
      this.nearRemoveTarget.set(this.isOverRemoveTarget());
    }
  }

  onBubblePointerUp(): void {
    const wasDrag = this.dragMoved;
    const dropOnRemove = wasDrag && this.isOverRemoveTarget();
    this.dragStart = null;
    this.dragMoved = false;
    this.showRemoveTarget.set(false);
    this.nearRemoveTarget.set(false);

    if (dropOnRemove) {
      this.ui.remove();
      return;
    }
    if (wasDrag) return; // position already applied live during the move

    // A plain tap.
    if (this.ui.open()) {
      this.close();
    } else {
      this.ui.openChat();
    }
  }

  private isOverRemoveTarget(): boolean {
    const target = this.removeTargetEl()?.nativeElement;
    if (!target) return false;
    const rect = target.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return Math.hypot(this.lastPointer.x - cx, this.lastPointer.y - cy) <= REMOVE_DROP_RADIUS_PX;
  }

  private isHiddenRoute(url: string): boolean {
    return url.startsWith('/login') || url.startsWith('/register');
  }

  private isCartRoute(url: string): boolean {
    return url === '/cart' || url.startsWith('/cart?') || url.startsWith('/cart#');
  }

  private request(topic: string | undefined): void {
    this.busy.set(true);
    this.chatbot.ask({ topic }).subscribe({
      next: (res) => {
        this.busy.set(false);
        this.messages.update((all) => [
          ...all,
          { from: 'bot', text: res.reply, quickReplies: res.quickReplies, escalate: res.escalate },
        ]);
      },
      error: () => {
        this.busy.set(false);
        this.messages.update((all) => [
          ...all,
          {
            from: 'bot',
            text: "Something went wrong on our end. Please try again, or reach us directly at +91 8657781526.",
            quickReplies: [],
            escalate: true,
          },
        ]);
      },
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Where the bubble really is, as distances from the right and bottom edges of the viewport. */
function renderedPosition(event: PointerEvent): { right: number; bottom: number } {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  return { right: window.innerWidth - rect.right, bottom: window.innerHeight - rect.bottom };
}

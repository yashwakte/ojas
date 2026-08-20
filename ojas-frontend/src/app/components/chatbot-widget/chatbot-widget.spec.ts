import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError, Subject } from 'rxjs';
import { ChatbotWidget } from './chatbot-widget';
import { ChatbotService } from '../../services/chatbot.service';
import { ChatbotUiService } from '../../services/chatbot-ui.service';
import { ChatbotResponse } from '../../models/interfaces';

// A trivial routed stub - the router just needs something to navigate to so NavigationEnd
// actually fires and router.url actually updates, which an empty route table wouldn't do.
@Component({ template: '' })
class BlankStubPage {}

describe('ChatbotWidget', () => {
  let chatbotServiceSpy: jasmine.SpyObj<ChatbotService>;
  let chatbotUi: ChatbotUiService;
  let router: Router;

  const greeting: ChatbotResponse = {
    reply: 'Hi! I can help with orders, delivery, stock, or cancellations.',
    escalate: false,
    quickReplies: [
      { label: 'Track my order', topic: 'order-status' },
      { label: 'Check product stock', topic: 'stock' },
    ],
  };

  // A minimal stand-in for PointerEvent - real DOM elements from TestBed-rendered fixtures do
  // support setPointerCapture, but constructing genuine PointerEvents in Karma/Chrome for
  // synthetic coordinates is more ceremony than this needs; the component only reads these
  // three things off the event.
  function pointerEvent(clientX: number, clientY: number): PointerEvent {
    return {
      clientX,
      clientY,
      pointerId: 1,
      target: { setPointerCapture: () => {} },
    } as unknown as PointerEvent;
  }

  beforeEach(() => {
    localStorage.clear();
    chatbotServiceSpy = jasmine.createSpyObj('ChatbotService', ['ask']);
    chatbotServiceSpy.ask.and.returnValue(of(greeting));

    TestBed.configureTestingModule({
      imports: [ChatbotWidget],
      providers: [
        { provide: ChatbotService, useValue: chatbotServiceSpy },
        provideRouter([
          { path: 'login', component: BlankStubPage },
          { path: 'register', component: BlankStubPage },
          { path: 'products', component: BlankStubPage },
        ]),
      ],
    });
    chatbotUi = TestBed.inject(ChatbotUiService);
    router = TestBed.inject(Router);
  });

  afterEach(() => localStorage.clear());

  function create() {
    const fixture = TestBed.createComponent(ChatbotWidget);
    fixture.detectChanges();
    return fixture;
  }

  function flush(fixture: ReturnType<typeof create>) {
    TestBed.flushEffects();
    fixture.detectChanges();
  }

  it('starts closed with no messages sent', () => {
    create();
    expect(chatbotUi.open()).toBeFalse();
    expect(chatbotServiceSpy.ask).not.toHaveBeenCalled();
  });

  it('a plain tap on the bubble opens the panel and requests the greeting with no topic', () => {
    const fixture = create();
    const widget = fixture.componentInstance;

    widget.onBubblePointerDown(pointerEvent(300, 700));
    widget.onBubblePointerUp();
    flush(fixture);

    expect(chatbotUi.open()).toBeTrue();
    expect(chatbotServiceSpy.ask).toHaveBeenCalledWith({ topic: undefined });
    expect(widget.messages()).toEqual([jasmine.objectContaining({ from: 'bot', text: greeting.reply })]);
  });

  it('re-opening after the first time does not re-request the greeting', () => {
    const fixture = create();
    const widget = fixture.componentInstance;

    widget.onBubblePointerDown(pointerEvent(300, 700));
    widget.onBubblePointerUp();
    flush(fixture);

    widget.close();
    chatbotServiceSpy.ask.calls.reset();
    chatbotUi.openChat();
    flush(fixture);

    expect(chatbotServiceSpy.ask).not.toHaveBeenCalled();
  });

  it('a tap while open closes the panel after the close animation delay', () => {
    jasmine.clock().install();
    try {
      const fixture = create();
      const widget = fixture.componentInstance;
      chatbotUi.openChat();
      flush(fixture);

      widget.onBubblePointerDown(pointerEvent(300, 700));
      widget.onBubblePointerUp();

      expect(widget.closing()).toBeTrue();
      expect(chatbotUi.open()).toBeTrue();

      jasmine.clock().tick(300);
      expect(chatbotUi.open()).toBeFalse();
      expect(widget.closing()).toBeFalse();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('dragging past the threshold moves the bubble, shows the remove target, and does not open the panel', () => {
    const fixture = create();
    const widget = fixture.componentInstance;
    const startPos = chatbotUi.position();

    widget.onBubblePointerDown(pointerEvent(300, 700));
    widget.onBubblePointerMove(pointerEvent(280, 650)); // moved 20px left, 50px up - past threshold
    flush(fixture);

    expect(widget.showRemoveTarget()).toBeTrue();

    widget.onBubblePointerUp();
    flush(fixture);

    expect(chatbotUi.open()).toBeFalse();
    expect(chatbotServiceSpy.ask).not.toHaveBeenCalled();
    // Moved left -> further from the right edge; moved up -> further from the bottom edge.
    expect(chatbotUi.position().right).toBeGreaterThan(startPos.right);
    expect(chatbotUi.position().bottom).toBeGreaterThan(startPos.bottom);
    expect(widget.showRemoveTarget()).toBeFalse(); // hidden again once the drag ends
  });

  it('a tiny movement under the drag threshold still counts as a tap', () => {
    const fixture = create();
    const widget = fixture.componentInstance;

    widget.onBubblePointerDown(pointerEvent(300, 700));
    widget.onBubblePointerMove(pointerEvent(302, 701)); // 2-3px jitter, well under the threshold
    widget.onBubblePointerUp();
    flush(fixture);

    expect(chatbotUi.open()).toBeTrue();
    expect(widget.showRemoveTarget()).toBeFalse();
  });

  it('dropping on the remove target removes the bubble instead of just repositioning it', () => {
    const fixture = create();
    const widget = fixture.componentInstance;
    // The real geometry (does the pointer's last position actually land on the rendered
    // target?) is covered separately below - this test is about the control flow once that
    // check comes back true.
    spyOn(widget as unknown as { isOverRemoveTarget(): boolean }, 'isOverRemoveTarget').and.returnValue(true);

    widget.onBubblePointerDown(pointerEvent(300, 700));
    widget.onBubblePointerMove(pointerEvent(200, 500));
    widget.onBubblePointerUp();
    flush(fixture);

    expect(chatbotUi.removed()).toBeTrue();
    expect(chatbotUi.open()).toBeFalse();
  });

  it('dropping away from the remove target just finalizes the dragged position', () => {
    const fixture = create();
    const widget = fixture.componentInstance;
    spyOn(widget as unknown as { isOverRemoveTarget(): boolean }, 'isOverRemoveTarget').and.returnValue(false);

    widget.onBubblePointerDown(pointerEvent(300, 700));
    widget.onBubblePointerMove(pointerEvent(200, 500));
    widget.onBubblePointerUp();

    expect(chatbotUi.removed()).toBeFalse();
  });

  it('the remove target, once actually rendered, sits where a dropped pointer is detected as "on" it', () => {
    const fixture = create();
    const widget = fixture.componentInstance;
    document.body.appendChild(fixture.nativeElement);

    try {
      widget.onBubblePointerDown(pointerEvent(300, 700));
      widget.onBubblePointerMove(pointerEvent(300, 600)); // cross the drag threshold
      flush(fixture);

      const targetEl = document.querySelector('.cw-remove-target') as HTMLElement;
      expect(targetEl).withContext('remove target should be rendered while dragging').not.toBeNull();
      const rect = targetEl.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      widget.onBubblePointerMove(pointerEvent(centerX, centerY));
      widget.onBubblePointerUp();
      flush(fixture);

      expect(chatbotUi.removed()).toBeTrue();
    } finally {
      document.body.removeChild(fixture.nativeElement);
    }
  });

  it('openChat from outside the widget (e.g. the hamburger menu) also triggers the greeting', () => {
    const fixture = create();
    const widget = fixture.componentInstance;

    chatbotUi.openChat();
    flush(fixture);

    expect(chatbotServiceSpy.ask).toHaveBeenCalledWith({ topic: undefined });
    expect(widget.messages().length).toBe(1);
  });

  it('clicking a quick reply pushes a user message and asks with that topic', () => {
    const fixture = create();
    const widget = fixture.componentInstance;
    chatbotUi.openChat();
    flush(fixture);
    chatbotServiceSpy.ask.calls.reset();
    chatbotServiceSpy.ask.and.returnValue(
      of({ reply: 'Please log in first.', escalate: false, quickReplies: [] }),
    );

    widget.sendQuickReply({ label: 'Track my order', topic: 'order-status' });

    expect(chatbotServiceSpy.ask).toHaveBeenCalledWith({ topic: 'order-status' });
    const messages = widget.messages();
    expect(messages[messages.length - 2]).toEqual(
      jasmine.objectContaining({ from: 'user', text: 'Track my order' }),
    );
  });

  it('a quick reply is ignored while a request is in flight', () => {
    const pending = new Subject<ChatbotResponse>();
    chatbotServiceSpy.ask.and.returnValue(pending.asObservable());
    const fixture = create();
    const widget = fixture.componentInstance;

    chatbotUi.openChat(); // kicks off the (still-pending) greeting request
    flush(fixture);
    expect(widget.busy()).toBeTrue();

    chatbotServiceSpy.ask.calls.reset();
    widget.sendQuickReply({ label: 'Track my order', topic: 'order-status' });

    expect(chatbotServiceSpy.ask).not.toHaveBeenCalled();

    pending.next(greeting);
    pending.complete();
  });

  it('a failed request shows a fallback message with the support number', () => {
    chatbotServiceSpy.ask.and.returnValue(throwError(() => new Error('network down')));
    const fixture = create();
    const widget = fixture.componentInstance;

    chatbotUi.openChat();
    flush(fixture);

    const messages = widget.messages();
    expect(messages[0].text).toContain('8657781526');
    expect(messages[0].escalate).toBeTrue();
  });

  describe('hidden on auth routes', () => {
    it('is hidden when created directly on /login', async () => {
      await router.navigateByUrl('/login');
      const fixture = create();

      expect(fixture.componentInstance.hiddenOnRoute()).toBeTrue();
    });

    it('is visible on an ordinary route', async () => {
      await router.navigateByUrl('/products');
      const fixture = create();

      expect(fixture.componentInstance.hiddenOnRoute()).toBeFalse();
    });

    it('hides itself when navigating to /register mid-session, and reappears after navigating away', async () => {
      const fixture = create();
      expect(fixture.componentInstance.hiddenOnRoute()).toBeFalse();

      await router.navigateByUrl('/register');
      flush(fixture);
      expect(fixture.componentInstance.hiddenOnRoute()).toBeTrue();

      await router.navigateByUrl('/products');
      flush(fixture);
      expect(fixture.componentInstance.hiddenOnRoute()).toBeFalse();
    });
  });
});

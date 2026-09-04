using System.ComponentModel.DataAnnotations;

namespace OjasApi.Models;

public record RegisterRequest(
	[Required, MinLength(2), MaxLength(80)] string FullName,
	[Required, EmailAddress, MaxLength(120)] string Email,
	[Required, MinLength(10), MaxLength(20)] string Phone,
	[Required, MinLength(10), MaxLength(128)] string Password,
	[Required] string TurnstileToken);

/// <summary>Identifier is either the account's email or its phone number - both are unique
/// per account and both are verified at registration, so either safely identifies who is
/// trying to sign in. AuthService.FindByCredentialsAsync checks it against both fields rather
/// than the caller having to say which kind it typed.</summary>
public record LoginRequest(
	[Required, MaxLength(120)] string Identifier,
	[Required, MinLength(6), MaxLength(128)] string Password,
	[Required] string TurnstileToken);

/// <summary>No password: the account is created dormant and the staff member sets their own
/// when they accept the emailed invite, so an admin never learns their credentials.</summary>
public record CreateStaffRequest(
	[Required, MinLength(2), MaxLength(80)] string FullName,
	[Required, EmailAddress, MaxLength(120)] string Email,
	[Required, MinLength(10), MaxLength(20)] string Phone,
	[Required] string Role);

public record AcceptInviteRequest(
	[Required] string Token,
	[Required, MinLength(10), MaxLength(128)] string Password);

/// <summary>Shown on the invite screen before the password is set, so the person can see whose
/// account they're activating without the token itself revealing anything if it leaks.</summary>
public record InvitePreviewResponse(string FullName, string Email, string Role);

public record AuthResponse(string Id, string FullName, string Email, string Phone, string Role, string CsrfToken = "");

/// <summary>RawDeviceId is set only when a session also binds a new staff device, so the
/// controller knows to write the device cookie; null for ordinary customer sessions.</summary>
public record AuthResult(string Token, AuthResponse User, string RefreshToken, string? RawDeviceId = null);

/// <summary>The service-layer twin of RegistrationStepResponse - Session is set only once both
/// EmailVerified and PhoneVerified are true.</summary>
/// <summary>Email and Phone are the account's own values regardless of which one this step was
/// for - the frontend needs both to drive whichever step comes next, and a caller who resumed
/// via a link carrying only the email (or only the phone) would otherwise have no way to learn
/// the other.</summary>
public record RegistrationStepResult(AuthResult? Session, bool EmailVerified, bool PhoneVerified, string Email, string Phone);

public enum LoginOutcome
{
	Success,
	InvalidCredentials,
	NeedsEmailVerification,
	/// <summary>Password was correct and email is verified, but registration was abandoned
	/// before the phone step - without this, an account could complete only email and then
	/// log in with password forever, never actually finishing the phone verification
	/// registration is supposed to require.</summary>
	NeedsPhoneVerification,
	/// <summary>Password was correct, but this staff account is bound to a different device.</summary>
	NeedsDeviceEnrollment,
}

/// <summary>Email is the resolved account's actual email - not an echo of whatever identifier
/// the caller typed, since that could have been the phone number. NeedsEmailVerification and
/// NeedsDeviceEnrollment both need a real email to act on (a resend, a device-approval code).</summary>
public record LoginServiceResult(LoginOutcome Outcome, AuthResult? Auth = null, string? Email = null, string? Phone = null);

/// <summary>Who the session cookie currently belongs to, straight from the server. The browser
/// keeps a cached copy of the signed-in user so the first paint isn't blank, but cookies are
/// shared by every tab in a profile - so the cache can silently belong to a different account
/// than the cookie does. This is the answer the frontend reconciles that cache against; it
/// carries no CSRF token, because it never establishes a session, it only describes one.</summary>
public record SessionResponse(
	string Id,
	string FullName,
	string Email,
	string Phone,
	string Role,
	string CsrfToken);

public enum RefreshOutcome
{
	Success,
	/// <summary>Unknown, expired, or no longer bound to the device it was issued to.</summary>
	Invalid,
	/// <summary>A refresh token that had already been spent was presented again, long enough
	/// after the fact that it can't be an honest race between two tabs. Someone is holding a
	/// copy they shouldn't, so the whole family from that sign-in has been revoked.</summary>
	ReuseDetected,
}

/// <summary>IsGraceReplay marks the honest two-tab case: this token had already been exchanged
/// moments earlier, so the caller gets a fresh access token but no new refresh token - the
/// browser's cookie jar is shared and already holds the successor the other tab was issued.
/// See AuthService.RefreshAsync for why not issuing one is the point.</summary>
public record RefreshResult(
	RefreshOutcome Outcome,
	AuthResult? Auth = null,
	bool IsGraceReplay = false);

public record DeviceOtpRequest(
	[Required, EmailAddress, MaxLength(120)] string Email,
	[Required, MinLength(6), MaxLength(128)] string Password);

public record EnrollDeviceRequest(
	[Required, EmailAddress, MaxLength(120)] string Email,
	[Required, MinLength(6), MaxLength(128)] string Password,
	[Required, RegularExpression(@"^\d{6}$")] string Code);

/// <summary>No Code field, by design: trust here comes from an admin's own authenticated
/// approval rather than proof of email control, so there's nothing for a code to add.</summary>
public record PreApprovedEnrollRequest(
	[Required, EmailAddress, MaxLength(120)] string Email,
	[Required, MinLength(6), MaxLength(128)] string Password);

public record ForgotPasswordRequest(
	[Required, EmailAddress, MaxLength(120)] string Email,
	[Required] string TurnstileToken);

/// <summary>The new password is held to the same 10-character floor as registration - a reset
/// must never be a way to downgrade an account to a weaker password than signup allows.</summary>
public record ResetPasswordRequest(
	[Required, EmailAddress, MaxLength(120)] string Email,
	[Required, RegularExpression(@"^\d{6}$")] string Code,
	[Required, MinLength(10), MaxLength(128)] string NewPassword);

public record StaffDeviceResponse(
	string Label,
	string EnrolledVia,
	DateTime CreatedAt,
	DateTime LastSeenAt);

/// <summary>Returned by /register while the account is awaiting OTP verification - deliberately
/// not an AuthResponse, since no session exists until the code is verified.</summary>
public record RegisterPendingResponse(string Email, string Message, string? DevCode = null);

public record VerifyEmailOtpRequest(
	[Required, EmailAddress] string Email,
	[Required, RegularExpression(@"^\d{6}$")] string Code);

public record ResendEmailOtpRequest([Required, EmailAddress] string Email);

/// <summary>WidgetToken is the access token MSG91's OTP Widget hands back after the customer
/// enters the code during registration - Ojas never sees the raw digits, only this token, which
/// Msg91WidgetVerifier checks server-side and binds to Phone before trusting it.</summary>
public record VerifyPhoneRegistrationRequest(
	[Required, MinLength(10), MaxLength(20)] string Phone,
	[Required] string WidgetToken);

/// <summary>Registration now requires both steps - verify-email-otp and
/// verify-phone-registration - completable in either order. Whichever one finishes second
/// carries Session; the other reports what's still outstanding so the frontend knows which
/// screen to show next. Email and Phone are always the account's real values, regardless of
/// which step this response is for - a caller who resumed via a link carrying only one of them
/// (e.g. login's needsEmailVerification redirect) needs the other to drive the next step.</summary>
public record RegistrationStepResponse(
	string Message,
	bool EmailVerified,
	bool PhoneVerified,
	string Email,
	string Phone,
	AuthResponse? Session = null);

/// <summary>InvitePending is true while the account still has no password - i.e. the invite was
/// sent but never accepted. The admin UI surfaces it so a stalled onboarding is visible.</summary>
public record StaffUserResponse(
	string Id,
	string FullName,
	string Email,
	string Phone,
	string Role,
	bool InvitePending = false,
	DateTime? PendingDeviceApprovalExpiresAt = null);

public record SavedAddressDto(string Label, string FullAddress, double Latitude, double Longitude, string? MapLink, bool IsDefault, string Phone);
/// <summary>Each saved address carries its own delivery contact number - a customer may
/// want a different person reached at their office address than at home.</summary>
public record SaveAddressRequest(string Label, string FullAddress, [Required] double? Latitude, [Required] double? Longitude, bool IsDefault, [Required, MinLength(10), MaxLength(20)] string Phone);
public record UpdateProfileRequest(string FullName, string Email, string Phone);

/// <summary>IsEmailVerified and IsPhoneVerified are carried so the profile screen can say which
/// contact details have actually been proved and offer to verify the email. Registration verifies
/// the phone only, so an ordinary customer arrives here with an unverified address and no other
/// route to confirming it.</summary>
public record UserProfileResponse(
	string Id,
	string FullName,
	string Email,
	string Phone,
	DateTime CreatedAt,
	List<SavedAddressDto> SavedAddresses,
	bool IsEmailVerified = false,
	bool IsPhoneVerified = false);

/// <summary>ProductId is the only field here the server trusts. Name, price and weight are all
/// re-read from the catalog — they are carried only so a request reads like what the browser
/// showed. Bounded anyway, since nothing stops a crafted request sending megabytes.</summary>
public record OrderItemDto(
	[Required, MaxLength(64)] string ProductId,
	[MaxLength(200)] string ProductName,
	decimal Price,
	[MaxLength(50)] string Weight,
	int Quantity);
/// <summary>CouponCode is a customer pick, not a price - like everything else here it is
/// re-validated server-side against the current subtotal, never trusted for its discount.</summary>
/// <summary>UseWallet defaults to true: the balance is applied unless the customer deliberately
/// unticks it to save the credit for later.</summary>
/// <summary>RetryOfOrderId names a failed order this one is replacing, so the dead attempt can
/// drop out of the customer's list once its replacement exists. Only honoured for an order that
/// belongs to the same customer and actually failed.</summary>
public record PlaceOrderRequest(
	[Required, MaxLength(80)] string FullName,
	[Required, MinLength(10), MaxLength(20)] string Phone,
	[Required, MaxLength(500)] string Address,
	[Required] double? Latitude,
	[Required] double? Longitude,
	[MaxLength(500)] string Notes,
	[Required, MinLength(1), MaxLength(60)] List<OrderItemDto> Items,
	[MaxLength(32)] string? CouponCode = null,
	bool UseWallet = true,
	[MaxLength(64)] string? RetryOfOrderId = null);
public record UpdateOrderStatusRequest([Required] string Status);
public record UpdateMyOrderRequest(
	[Required, MaxLength(80)] string FullName,
	[Required, MinLength(10), MaxLength(20)] string Phone,
	[Required, MaxLength(500)] string Address,
	[Required] double? Latitude,
	[Required] double? Longitude,
	[MaxLength(500)] string Notes,
	[Required, MinLength(1), MaxLength(60)] List<OrderItemDto> Items,
	[MaxLength(32)] string? CouponCode = null);
public record AssignDeliveryPartnerRequest([Required] string DeliveryPartnerId);
public record OrderResponse(
	string Id,
	string FullName,
	string Phone,
	string Address,
	double Latitude,
	double Longitude,
	string? AddressMapLink,
	string Notes,
	List<OrderItemDto> Items,
	decimal Subtotal,
	string? CouponCode,
	decimal DiscountPercentage,
	decimal DiscountAmount,
	decimal DeliveryCharge,
	double DeliveryDistanceKm,
	decimal TotalAmount,
	string Status,
	string PaymentMethod,
	string PaymentStatus,
	DateTime CreatedAt,
	string? DeliveryPartnerId,
	string? DeliveryPartnerName,
	DateTime? UpdatedAt,
	string? PaymentSessionId = null,
	string? PaymentInstrument = null,
	decimal AmountPaid = 0,
	decimal? RefundPendingAmount = null,
	decimal WalletAmountApplied = 0,
	PendingAmendmentDto? PendingAmendment = null,
	string? PaymentFailureReason = null,
	/// <summary>What the payment gateway knocked off - a bank offer or a code entered on its own
	/// page. The customer was charged less than the order total by exactly this much, and owes
	/// nothing further; without showing it, the order reads as though money is missing.</summary>
	decimal GatewayDiscount = 0,
	/// <summary>What has been handed back so far - wallet credit and refunds to the original
	/// payment method alike. Without it a cancelled order shows nothing paid and no sign of where
	/// the money went, which reads exactly like it was kept.</summary>
	decimal AmountRefunded = 0,
	/// <summary>The share of AmountRefunded that went back to the original payment method, and
	/// the share that went to the Ojas wallet. One cancellation routinely splits both ways, and a
	/// single total cannot say which money the customer should be looking for where.</summary>
	decimal RefundedToSource = 0,
	decimal RefundedToWallet = 0);

/// <summary>An edit the customer priced but hasn't paid the difference for yet. The order's own
/// fields above still describe what was actually bought and paid for — this is only a proposal,
/// and it disappears if the top-up goes unpaid.</summary>
public record PendingAmendmentDto(
	List<OrderItemDto> Items,
	decimal Subtotal,
	string? CouponCode,
	decimal DiscountAmount,
	decimal DeliveryCharge,
	decimal TotalAmount,
	decimal TopUpAmount,
	string? PaymentSessionId,
	DateTime ExpiresAt);

/// <summary>Where a cancelling customer wants their money. "wallet" is credited instantly;
/// "source" goes back to the original payment method and waits on an admin.</summary>
public record CancelOrderRequest(string RefundDestination = RefundDestinations.Wallet);

public static class RefundDestinations
{
	public const string Wallet = "wallet";
	public const string Source = "source";

	public static bool IsValid(string value) =>
		value is Wallet or Source;
}

/// <summary>What actually happened to the customer's money when they cancelled, so the UI can
/// say so rather than guessing.
///
/// Order is the order as it now stands. Cancelling moves far more than the status — it discards
/// any pending edit, returns wallet credit, and re-derives what the order holds — so the whole
/// order comes back rather than leaving the page to patch one field and keep the rest of its
/// pre-cancellation copy. That is what left a cancelled order still offering to take a payment.</summary>
public record CancelOrderResponse(
	decimal WalletCredited,
	decimal SourceRefundQueued,
	OrderResponse? Order = null);

public record WalletTransactionResponse(
	decimal Amount,
	decimal BalanceAfter,
	string Reason,
	string? OrderId,
	DateTime CreatedAt);

public record WalletResponse(decimal Balance, List<WalletTransactionResponse> Transactions);

/// <summary>An edit can move money, so it reports more than the updated order. TopUpAmount +
/// PaymentSessionId are set when the new total exceeds what was captured and the difference must
/// be paid online; RefundAmount when it falls below and the money comes back as wallet credit;
/// RemovedCouponCode when the edit dropped the cart under that coupon's minimum cart value.
///
/// PendingPayment says the changes have <em>not</em> been made yet: they cost more than the order
/// holds, so they are parked as a pending amendment and Order still describes the order as it
/// stands. Only paying TopUpAmount makes them real, and abandoning the payment discards them.</summary>
public record UpdateMyOrderResponse(
	OrderResponse Order,
	decimal? TopUpAmount,
	string? PaymentSessionId,
	decimal? RefundAmount,
	string? RemovedCouponCode,
	bool PendingPayment = false);

/// <summary>The answer to "I still owe money on this order — let me pay it."
///
/// Exactly one of three things is true, and the UI must be able to tell them apart, because the
/// wrong one invites a customer to pay a second time for something already settled:
///
/// <list type="bullet">
/// <item><description><c>PaymentSessionId</c> set — a fresh gateway order exists for
/// <c>AmountDue</c> and the customer should be sent to the payment page.</description></item>
/// <item><description><c>AlreadyPaid</c> — asking the gateway found money we hadn't recorded yet;
/// there is nothing to pay and <c>Order</c> shows it settled.</description></item>
/// <item><description><c>PaymentInFlight</c> — the bank is still deciding on a payment that has
/// already been made. No new payment may be raised until that resolves.</description></item>
/// </list>
///
/// Order is always the order as it now stands, so the page swaps it in whole rather than patching
/// a field onto a copy that predates the reconciliation this endpoint just performed.</summary>
public record ResumePaymentResponse(
	OrderResponse Order,
	decimal AmountDue,
	string? PaymentSessionId = null,
	bool AlreadyPaid = false,
	bool PaymentInFlight = false);

/// <summary>What the browser needs to know before it can open a payment page: which Cashfree
/// environment the server is talking to, so the checkout SDK is loaded in the matching mode.
///
/// It is deliberately the server that answers this. The mode used to be a constant compiled into
/// the frontend bundle while the API read its own from an environment variable, which meant going
/// live required changing two things in two places in lockstep — and getting them out of step
/// breaks every payment on the site, because a payment session raised in one environment will not
/// open in the other. Nothing secret is exposed: which environment we use is plainly visible in
/// the payment page's own URL.
///
/// <paramref name="Configured"/> reports whether credentials exist at all, so an unconfigured
/// gateway can be said out loud rather than discovered when a customer tries to pay.</summary>
/// <paramref name="ReturnOrigin"/> is the origin Cashfree hands a paying customer back to. It is
/// reported so that a domain move can be verified in one request instead of by making a real
/// payment: point it at the old host and payments still succeed, but customers land on an origin
/// their auth cookie was never set for, arrive signed out, cannot see the order they just paid
/// for, and reasonably conclude the money vanished. Nothing secret - it is a public website
/// address, and it appears in the payment page's own URL bar on the way back.
public record CashfreeConfigResponse(string Mode, bool Configured, string ReturnOrigin = "");

/// <summary>The server's verdict after asking the gateway directly. AmendmentDiscarded reports
/// that the customer left the payment page without paying, so the edit they were paying for has
/// been dropped and their order is untouched — the UI has to say so rather than leaving them
/// watching a spinner that will never resolve.
///
/// Order is the order as it now stands. It is returned in full rather than leaving the browser to
/// patch a field or two onto the copy it fetched *before* the payment was recorded: confirming a
/// payment moves the amount paid, the status, and — when a pending edit was what got paid for —
/// the items and total as well. Patching only the status is what left a freshly paid order still
/// claiming nothing had been paid on it until the customer reloaded the page.</summary>
public record CashfreePaymentStatusResponse(
	string PaymentStatus,
	string? PaymentInstrument,
	bool AmendmentDiscarded = false,
	string? PaymentFailureReason = null,
	OrderResponse? Order = null,
	string Outcome = PaymentAttemptOutcomes.Paid);

/// <summary>
/// What became of the payment the customer has just come back from — which is <em>not</em> the
/// same question as how the order stands overall. A top-up left pending at the bank leaves the
/// order itself fully paid for its current contents, so reporting the order's status told the
/// customer "payment successful" while the thing they had just tried to pay for sat unapplied
/// underneath. The two are reported separately for that reason.
/// </summary>
public static class PaymentAttemptOutcomes
{
	/// <summary>The money landed, and whatever it was for has been applied.</summary>
	public const string Paid = "Paid";

	/// <summary>Still with the bank — a UPI collect awaiting approval, say. Nothing is settled
	/// yet, and the customer must not be invited to pay again while it is outstanding.</summary>
	public const string Pending = "Pending";

	/// <summary>Terminal, with no money taken.</summary>
	public const string Failed = "Failed";

	/// <summary>The customer left without paying, so the changes it was for were dropped.</summary>
	public const string Discarded = "Discarded";
}

/// <summary>RefundAmount is still capped server-side against what the order actually captured -
/// this is only the admin's requested amount, not the final authority.</summary>
public record RefundOrderRequest([Required] decimal RefundAmount, string? Note = null);

/// <summary>The result of an admin moving an order along. The whole order comes back rather than
/// a bare 204, because cancelling changes far more of it than the status - what it holds, what
/// was refunded, whether a refund is still owed - and a dashboard patching one field onto the
/// copy it already had would go on showing the rest as it was before.</summary>
public record AdminStatusChangeResponse(
	OrderResponse? Order,
	decimal WalletCredited,
	decimal RefundedToSource,
	decimal SourceRefundQueued,
	string? RefundError);

/// <summary>What cancelling this order would hand back, so the admin confirms against the real
/// figure instead of the dashboard guessing at it.</summary>
public record CancellationPreviewResponse(
	decimal AmountPaid,
	decimal WalletShare,
	decimal GatewayShare,
	bool HasPendingAmendment);

public record RefundOrderResponse(decimal Refunded, string? Error, OrderResponse? Order);


/// <summary>PricedByPincode says the charge came from the admin's serviceable-pincode list rather
/// than from the map pin, which is what makes it safe from a browser that lies about where it is.
/// The UI uses it only to word "we don't deliver there" correctly.</summary>
public record DeliveryChargeCalculationResponse(
	double DistanceKm,
	decimal Charge,
	bool IsFree,
	bool IsServiceable,
	double MaxRadiusKm,
	bool PricedByPincode = false);

/// <summary>Topic always comes from a quick-reply button the frontend rendered - there is no
/// free-text input, so nothing here is ever guessed from typed text. Null/absent means "show the
/// greeting and main menu" (the very first request when the widget opens).</summary>
public record ChatbotRequest(string? Topic);

public record ChatbotQuickReply(string Label, string Topic);

/// <summary>Escalate is a hint for the UI (e.g. show the "talk to a human" contact details more
/// prominently) - it's not a separate channel, the reply text already contains everything the
/// bot has to say.</summary>
public record ChatbotResponse(string Reply, bool Escalate, List<ChatbotQuickReply> QuickReplies);

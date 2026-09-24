using Microsoft.Extensions.DependencyInjection;
using System.Net;
using System.Net.Http.Json;
using OjasApi.Models;
using OjasApi.Services;
using Shouldly;

namespace OjasApi.Tests.Integration;

/// <summary>
/// Product reviews against real MongoDB: who may write one, one review per purchase (a unique
/// index, which only a real database enforces), the rating written onto the product, and what the
/// public reads leave out.
/// </summary>
[Collection(MongoCollectionFixture.Name)]
public class ReviewFlowTests : IDisposable
{
    private readonly OjasApiFactory _factory;
    private readonly HttpClient _customer;
    private string _customerCsrf = string.Empty;

    public ReviewFlowTests(MongoRunnerFixture mongo)
    {
        _factory = new OjasApiFactory(mongo);
        _customer = _factory.CreateClient();
    }

    public void Dispose()
    {
        _customer.Dispose();
        _factory.Dispose();
    }

    private const double Lat = 18.0;
    private const double Lng = 73.0;

    /// <summary>A paid order for one product, optionally walked through to delivered.</summary>
    private async Task<(OrderResponse Order, Product Product, HttpClient Admin, string AdminCsrf)> OrderAsync(
        bool deliver = true, string fullName = "Priya Sharma")
    {
        await _factory.SeedAsync(async db => await db.DeliveryCharges.InsertOneAsync(new DeliveryCharges
        {
            WarehouseAddress = "Test Warehouse",
            WarehouseLatitude = Lat,
            WarehouseLongitude = Lng,
            FreeDeliveryUpToKm = 5,
            PerKmChargeAfterFree = 10,
            IsActive = true,
        }));

        var product = await _factory.SeedProductAsync(price: 100m);
        var (_, csrf) = await _customer.RegisterAsync(fullName: fullName);
        _customerCsrf = csrf;

        var place = new HttpRequestMessage(HttpMethod.Post, "/api/orders")
        {
            Content = JsonContent.Create(new PlaceOrderRequest(
                fullName, "9123456789", "123 Main St", Lat, Lng, "",
                [new(product.Id!, product.Name, product.Price, product.Weight, 1)])),
        };
        place.AttachCsrf(csrf);
        var order = (await (await _customer.SendAsync(place))
            .Content.ReadFromJsonAsync<OrderResponse>())!;

        _factory.Cashfree.PayAllOutstanding();
        (await _customer.GetAsync($"/api/payments/cashfree/status/{order.Id}"))
            .StatusCode.ShouldBe(HttpStatusCode.OK);

        var admin = _factory.CreateClient();
        var (_, adminCsrf) = await _factory.SeedAndLoginAsStaffAsync(admin, UserRoles.Admin);

        if (deliver)
        {
            var delivered = new HttpRequestMessage(HttpMethod.Patch, $"/api/orders/admin/{order.Id}/status")
            {
                Content = JsonContent.Create(new UpdateOrderStatusRequest("Delivered")),
            };
            delivered.AttachCsrf(adminCsrf);
            (await admin.SendAsync(delivered)).StatusCode.ShouldBe(HttpStatusCode.OK);
        }

        return (order, product, admin, adminCsrf);
    }

    /// <summary>Another paid and delivered order of the same product by the same customer.</summary>
    private async Task<OrderResponse> OrderAgainAsync(Product product, HttpClient admin, string adminCsrf)
    {
        var place = new HttpRequestMessage(HttpMethod.Post, "/api/orders")
        {
            Content = JsonContent.Create(new PlaceOrderRequest(
                "Priya Sharma", "9123456789", "123 Main St", Lat, Lng, "",
                [new(product.Id!, product.Name, product.Price, product.Weight, 2)])),
        };
        place.AttachCsrf(_customerCsrf);
        var order = (await (await _customer.SendAsync(place)).Content.ReadFromJsonAsync<OrderResponse>())!;
        _factory.Cashfree.PayAllOutstanding();
        (await _customer.GetAsync($"/api/payments/cashfree/status/{order.Id}")).StatusCode.ShouldBe(HttpStatusCode.OK);

        var delivered = new HttpRequestMessage(HttpMethod.Patch, $"/api/orders/admin/{order.Id}/status")
        {
            Content = JsonContent.Create(new UpdateOrderStatusRequest("Delivered")),
        };
        delivered.AttachCsrf(adminCsrf);
        (await admin.SendAsync(delivered)).StatusCode.ShouldBe(HttpStatusCode.OK);
        return order;
    }

    private Task<HttpResponseMessage> WriteAsync(string productId, int rating, string? comment, string? orderId = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Post,
            $"/api/reviews/my/{productId}" + (orderId == null ? "" : $"?orderId={orderId}"))
        {
            Content = JsonContent.Create(new WriteReviewRequest(rating, comment)),
        };
        request.AttachCsrf(_customerCsrf);
        return _customer.SendAsync(request);
    }

    private Task<HttpResponseMessage> EditAsync(string reviewId, int rating, string? comment)
    {
        var request = new HttpRequestMessage(HttpMethod.Put, $"/api/reviews/my/review/{reviewId}")
        {
            Content = JsonContent.Create(new WriteReviewRequest(rating, comment)),
        };
        request.AttachCsrf(_customerCsrf);
        return _customer.SendAsync(request);
    }

    [Fact]
    public async Task ABuyerWhoseOrderArrived_CanReview_AndItShowsOnTheProductPage()
    {
        var (_, product, admin, _) = await OrderAsync();
        admin.Dispose();

        var mine = await _customer.GetFromJsonAsync<MyReviewsResponse>("/api/reviews/my");
        mine!.ReviewableProductIds.ShouldContain(product.Id!);

        var write = await WriteAsync(product.Id!, 5, "  The modak pith made the softest ukadiche modak this year.  ");
        write.StatusCode.ShouldBe(HttpStatusCode.OK);

        using var guest = _factory.CreateClient();
        var page = await guest.GetFromJsonAsync<ProductReviewsResponse>($"/api/reviews/product/{product.Id}");
        page!.Summary.Count.ShouldBe(1);
        page.Summary.Average.ShouldBe(5);
        page.Summary.Distribution[4].ShouldBe(1);

        var review = page.Reviews.Single();
        review.AuthorName.ShouldBe("Priya S.");
        review.Comment.ShouldBe("The modak pith made the softest ukadiche modak this year.");
        review.OrderId.ShouldBeNull();
    }

    [Fact]
    public async Task AnOrderNotYetDelivered_DoesNotQualify()
    {
        var (_, product, admin, _) = await OrderAsync(deliver: false);
        admin.Dispose();

        var write = await WriteAsync(product.Id!, 4, "Looks good so far.");
        write.StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var mine = await _customer.GetFromJsonAsync<MyReviewsResponse>("/api/reviews/my");
        mine!.ReviewableProductIds.ShouldNotContain(product.Id!);
    }

    /// <summary>The owner's rule: one review per purchase. A second review of the same delivered
    /// order is refused - the customer edits the one they wrote.</summary>
    [Fact]
    public async Task OnePurchase_TakesOneReview_AndASecondIsRefused()
    {
        var (order, product, admin, _) = await OrderAsync();
        admin.Dispose();

        var first = await WriteAsync(product.Id!, 5, "Lovely.");
        first.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await first.Content.ReadFromJsonAsync<ReviewResponse>())!.PurchasedAt.ShouldNotBeNull();

        var again = await WriteAsync(product.Id!, 4, "Posting again.");
        again.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await again.Content.ReadAsStringAsync()).ShouldContain("already reviewed");
        (await WriteAsync(product.Id!, 4, "And again.", order.Id)).StatusCode.ShouldBe(HttpStatusCode.BadRequest);

        var page = await _customer.GetFromJsonAsync<ProductReviewsResponse>($"/api/reviews/product/{product.Id}");
        page!.Summary.Count.ShouldBe(1);

        var mine = await _customer.GetFromJsonAsync<MyReviewsResponse>("/api/reviews/my");
        mine!.ReviewableProductIds.ShouldNotContain(product.Id!);
    }

    /// <summary>The owner's example: Modak Pith bought on 7 Sep and reviewed, bought again on
    /// 21 Sep - that fresh purchase earns a fresh review, and each review carries the date of
    /// its own purchase so shoppers can tell them apart.</summary>
    [Fact]
    public async Task ASecondDeliveredPurchase_EarnsASecondReview_WithItsOwnPurchaseDate()
    {
        var (first, product, admin, adminCsrf) = await OrderAsync();
        using var _admin = admin;
        (await WriteAsync(product.Id!, 3, "First bag was fine.")).StatusCode.ShouldBe(HttpStatusCode.OK);

        var second = await OrderAgainAsync(product, admin, adminCsrf);
        (await _customer.GetFromJsonAsync<MyReviewsResponse>("/api/reviews/my"))!
            .ReviewableProductIds.ShouldContain(product.Id!);

        // The first order is spent; naming it is refused, naming the new one is not.
        (await WriteAsync(product.Id!, 5, "Again.", first.Id)).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        var ok = await WriteAsync(product.Id!, 5, "Second bag even better.", second.Id);
        ok.StatusCode.ShouldBe(HttpStatusCode.OK);
        (await ok.Content.ReadFromJsonAsync<ReviewResponse>())!.OrderId.ShouldBe(second.Id);

        var page = await _customer.GetFromJsonAsync<ProductReviewsResponse>($"/api/reviews/product/{product.Id}");
        page!.Summary.Count.ShouldBe(2);
        page.Summary.Average.ShouldBe(4);
        // Public reviews show when each purchase was made, but never which order it was.
        page.Reviews.ShouldAllBe(r => r.PurchasedAt != null && r.OrderId == null);
        page.Reviews.Select(r => r.PurchasedAt).Distinct().Count().ShouldBe(2);

        // Both purchases are now reviewed.
        (await WriteAsync(product.Id!, 4, "Third try.")).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    /// <summary>A product with many reviews is never sent whole: the first page carries the two
    /// best (most stars, then the fullest words) and ten reviews, newest first; "Show more" pages
    /// through the rest and carries no top reviews.</summary>
    [Fact]
    public async Task AProductsReviews_ComeTopTwoFirst_ThenTenAPage()
    {
        var (order, product, admin, _) = await OrderAsync();
        admin.Dispose();

        var now = DateTime.UtcNow;
        await _factory.SeedAsync(async db => await db.ProductReviews.InsertManyAsync(
            Enumerable.Range(0, 25).Select(i => new ProductReview
            {
                ProductId = product.Id!,
                ProductName = product.Name,
                UserId = $"66f0000000000000000001{i:D2}",
                OrderId = order.Id!,
                AuthorName = $"Buyer {i}",
                Rating = i == 3 || i == 7 ? 5 : 4,
                Comment = i == 7 ? "The longest and most helpful review of them all." : i == 3 ? "Five stars." : "Fine.",
                CreatedAt = now.AddMinutes(-i),
            })));

        var first = (await _customer.GetFromJsonAsync<ProductReviewsResponse>($"/api/reviews/product/{product.Id}"))!;
        first.Summary.Count.ShouldBe(25);
        first.Reviews.Count.ShouldBe(10);
        first.Reviews[0].AuthorName.ShouldBe("Buyer 0");
        first.Top!.Select(r => r.AuthorName).ShouldBe(["Buyer 7", "Buyer 3"]);

        var last = (await _customer.GetFromJsonAsync<ProductReviewsResponse>(
            $"/api/reviews/product/{product.Id}?skip=20&take=10"))!;
        last.Reviews.Count.ShouldBe(5);
        last.Top!.ShouldBeEmpty();

        // A request cannot ask for the whole list at once.
        (await _customer.GetFromJsonAsync<ProductReviewsResponse>(
            $"/api/reviews/product/{product.Id}?take=1000"))!.Reviews.Count.ShouldBe(ReviewService.ProductPageMax);
    }

    /// <summary>The catalogue's cards read the rating off the product itself.</summary>
    [Fact]
    public async Task TheProductCarriesItsRating_ForTheCatalogueCards()
    {
        var (_, product, admin, adminCsrf) = await OrderAsync();
        using var _admin = admin;

        var review = (await (await WriteAsync(product.Id!, 4, "Good.")).Content.ReadFromJsonAsync<ReviewResponse>())!;
        var listed = await _customer.GetFromJsonAsync<Product>($"/api/products/{product.Id}");
        listed!.RatingCount.ShouldBe(1);
        listed.RatingAverage.ShouldBe(4);

        var hide = new HttpRequestMessage(HttpMethod.Patch, $"/api/reviews/admin/{review.Id}/visibility")
        {
            Content = JsonContent.Create(new SetReviewVisibilityRequest(true)),
        };
        hide.AttachCsrf(adminCsrf);
        (await admin.SendAsync(hide)).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await _customer.GetFromJsonAsync<Product>($"/api/products/{product.Id}"))!.RatingCount.ShouldBe(0);
    }

    /// <summary>Several reviews of one purchase (left by an early build) collapse to the newest;
    /// a review of a different purchase of the same product is kept; the purchase date is filled
    /// in from the order; the rating is rebuilt from what is left.</summary>
    [Fact]
    public async Task BootCleanup_KeepsTheNewestReviewPerPurchase_AndFillsThePurchaseDate()
    {
        var (order, product, admin, _) = await OrderAsync();
        admin.Dispose();

        var baseReview = new Func<int, DateTime, string, ProductReview>((rating, at, orderId) => new ProductReview
        {
            ProductId = product.Id!,
            ProductName = product.Name,
            UserId = "66f000000000000000000001",
            OrderId = orderId,
            AuthorName = "Old B.",
            Rating = rating,
            CreatedAt = at,
        });
        await _factory.SeedAsync(async db =>
        {
            // The unique index may already exist from this app's own boot run; drop it so the
            // duplicates an old build left behind can be recreated here.
            try { await db.ProductReviews.Indexes.DropOneAsync(ReviewService.ReviewUniqueIndexName); } catch (MongoDB.Driver.MongoCommandException) { }
            await db.ProductReviews.InsertManyAsync([
                baseReview(5, DateTime.UtcNow.AddMinutes(-4), order.Id!),
                baseReview(4, DateTime.UtcNow.AddMinutes(-3), order.Id!),
                baseReview(2, DateTime.UtcNow.AddMinutes(-2), order.Id!),
                baseReview(4, DateTime.UtcNow.AddMinutes(-1), "66f0000000000000000000aa"),
            ]);
        });

        using var scope = _factory.Services.CreateScope();
        var removed = await scope.ServiceProvider.GetRequiredService<ReviewService>()
            .CollapseDuplicatesAndRebuildRatingsAsync();

        removed.ShouldBe(2);
        var page = await _customer.GetFromJsonAsync<ProductReviewsResponse>($"/api/reviews/product/{product.Id}");
        page!.Reviews.Count.ShouldBe(2);
        page.Reviews.Select(r => r.Rating).OrderBy(r => r).ShouldBe([2, 4]);
        // The real order's date is filled in; the order that no longer exists leaves it empty.
        page.Reviews.Single(r => r.Rating == 2).PurchasedAt.ShouldNotBeNull();
        page.Reviews.Single(r => r.Rating == 4).PurchasedAt.ShouldBeNull();
        (await _customer.GetFromJsonAsync<Product>($"/api/products/{product.Id}"))!.RatingAverage.ShouldBe(3);
    }

    [Fact]
    public async Task ACustomer_CanEditOneOfTheirReviews_ByItsId()
    {
        var (_, product, admin, _) = await OrderAsync();
        admin.Dispose();

        var first = (await (await WriteAsync(product.Id!, 3, "Fine.")).Content.ReadFromJsonAsync<ReviewResponse>())!;
        (await EditAsync(first.Id, 4, "Better on the second bake.")).StatusCode.ShouldBe(HttpStatusCode.OK);

        var page = await _customer.GetFromJsonAsync<ProductReviewsResponse>($"/api/reviews/product/{product.Id}");
        page!.Reviews.Single().Rating.ShouldBe(4);
        page.Reviews.Single().UpdatedAt.ShouldNotBeNull();
    }

    [Fact]
    public async Task AnotherCustomersReview_CannotBeEditedOrDeleted()
    {
        var (_, product, admin, _) = await OrderAsync();
        admin.Dispose();
        var mine = (await (await WriteAsync(product.Id!, 5, "Lovely.")).Content.ReadFromJsonAsync<ReviewResponse>())!;

        using var other = _factory.CreateClient();
        var (_, otherCsrf) = await other.RegisterAsync(fullName: "Someone Else");
        var edit = new HttpRequestMessage(HttpMethod.Put, $"/api/reviews/my/review/{mine.Id}")
        {
            Content = JsonContent.Create(new WriteReviewRequest(1, "Bad.")),
        };
        edit.AttachCsrf(otherCsrf);
        (await other.SendAsync(edit)).StatusCode.ShouldBe(HttpStatusCode.NotFound);

        var delete = new HttpRequestMessage(HttpMethod.Delete, $"/api/reviews/my/review/{mine.Id}");
        delete.AttachCsrf(otherCsrf);
        (await other.SendAsync(delete)).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task ARatingOutsideOneToFive_IsRefused()
    {
        var (_, product, admin, _) = await OrderAsync();
        admin.Dispose();

        (await WriteAsync(product.Id!, 0, null)).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
        (await WriteAsync(product.Id!, 6, null)).StatusCode.ShouldBe(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task AHiddenReview_LeavesThePublicReads_ButItsAuthorIsTold()
    {
        var (_, product, admin, adminCsrf) = await OrderAsync();
        using var _admin = admin;

        (await WriteAsync(product.Id!, 5, "Call me on 9123456789 for bulk orders, great flour!"))
            .StatusCode.ShouldBe(HttpStatusCode.OK);

        var all = await admin.GetFromJsonAsync<List<ReviewResponse>>("/api/reviews/admin/all");
        var target = all!.Single(r => r.ProductId == product.Id);
        target.OrderId.ShouldNotBeNull();

        var hide = new HttpRequestMessage(HttpMethod.Patch, $"/api/reviews/admin/{target.Id}/visibility")
        {
            Content = JsonContent.Create(new SetReviewVisibilityRequest(true)),
        };
        hide.AttachCsrf(adminCsrf);
        (await admin.SendAsync(hide)).StatusCode.ShouldBe(HttpStatusCode.OK);

        using var guest = _factory.CreateClient();
        var page = await guest.GetFromJsonAsync<ProductReviewsResponse>($"/api/reviews/product/{product.Id}");
        page!.Summary.Count.ShouldBe(0);
        page.Reviews.ShouldBeEmpty();
        (await guest.GetFromJsonAsync<List<ReviewResponse>>("/api/reviews/featured"))!
            .ShouldNotContain(r => r.Id == target.Id);

        var mine = await _customer.GetFromJsonAsync<MyReviewsResponse>("/api/reviews/my");
        mine!.Reviews.Single().IsHidden.ShouldBeTrue();

        // Editing it does not get round the takedown.
        (await EditAsync(target.Id, 5, "Great flour!")).StatusCode.ShouldBe(HttpStatusCode.OK);
        (await guest.GetFromJsonAsync<ProductReviewsResponse>($"/api/reviews/product/{product.Id}"))!
            .Summary.Count.ShouldBe(0);
    }

    [Fact]
    public async Task TheHomeWall_ShowsWellRatedReviewsThatSaySomething()
    {
        var (_, product, admin, _) = await OrderAsync();
        admin.Dispose();

        // Stars alone, or a word, make an empty card on the home page.
        var shortOne = (await (await WriteAsync(product.Id!, 5, "Good.")).Content.ReadFromJsonAsync<ReviewResponse>())!;
        (await _customer.GetFromJsonAsync<List<ReviewResponse>>("/api/reviews/featured"))!
            .ShouldBeEmpty();

        // The owner's own short review was left off the wall - two words are enough.
        (await EditAsync(shortOne.Id, 5, "Fantastic Taste")).StatusCode.ShouldBe(HttpStatusCode.OK);
        var featured = await _customer.GetFromJsonAsync<List<ReviewResponse>>("/api/reviews/featured");
        var shown = featured!.Single();
        shown.ProductName.ShouldBe(product.Name);
        shown.Comment.ShouldBe("Fantastic Taste");
    }

    /// <summary>One card per person: a customer with several reviews is shown once, by their
    /// best - most stars, then the fullest words.</summary>
    [Fact]
    public async Task TheHomeWall_ShowsEachCustomerOnce_ByTheirBestReview()
    {
        var (_, product, admin, adminCsrf) = await OrderAsync();
        using var _admin = admin;
        (await WriteAsync(product.Id!, 4, "Good flour, fine grind and fresh.")).StatusCode.ShouldBe(HttpStatusCode.OK);
        await OrderAgainAsync(product, admin, adminCsrf);
        (await WriteAsync(product.Id!, 5, "Short but sweet.")).StatusCode.ShouldBe(HttpStatusCode.OK);
        await OrderAgainAsync(product, admin, adminCsrf);
        (await WriteAsync(product.Id!, 5, "Our rotis are softer than they have been in years.")).StatusCode.ShouldBe(HttpStatusCode.OK);

        var featured = (await _customer.GetFromJsonAsync<List<ReviewResponse>>("/api/reviews/featured"))!;
        featured.Count.ShouldBe(1);
        featured[0].Comment.ShouldStartWith("Our rotis");
    }

    [Fact]
    public async Task OnlyAnAdmin_CanReachTheModerationList()
    {
        var (_, _, admin, _) = await OrderAsync();
        admin.Dispose();

        (await _customer.GetAsync("/api/reviews/admin/all")).StatusCode.ShouldBe(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task AnUnknownProduct_Is404_NotAServerError()
    {
        (await _customer.GetAsync("/api/reviews/product/no-such-flour")).StatusCode.ShouldBe(HttpStatusCode.NotFound);
    }

    [Theory]
    [InlineData("Priya Sharma", "Priya S.")]
    [InlineData("Priya", "Priya")]
    [InlineData("  amit  kumar kulkarni ", "amit K.")]
    [InlineData("", "Ojas customer")]
    [InlineData(null, "Ojas customer")]
    public void PublicName_ShowsFirstNameAndLastInitialOnly(string? fullName, string expected) =>
        ProductReview.PublicName(fullName).ShouldBe(expected);

    [Fact]
    public void CleanComment_TrimsCapsAndDropsControlCharacters()
    {
        ReviewService.CleanComment(" hi\u0007 there \r\n\r\n\r\n\r\nbye ").ShouldBe("hi there \n\nbye");
        ReviewService.CleanComment(new string('a', 900)).Length.ShouldBe(ProductReview.CommentMaxLength);
        ReviewService.CleanComment(null).ShouldBe(string.Empty);
    }
}

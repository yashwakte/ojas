using OjasApi.Models;

namespace OjasApi.Data;

public static class SeedData
{
    public static List<Product> GetProducts() =>
    [
        new Product
        {
            Name = "Bajra Flour",
            Description = "Premium quality bajra (pearl millet) flour, stone-ground for authentic taste. Rich in iron and fiber, perfect for bhakri and rotis.",
            Price = 85,
            Category = "Flour",
            Weight = "500g",
            ImageUrl = "/images/bajra-flour.jpg"
        },
        new Product
        {
            Name = "Anarasa Flour",
            Description = "Traditional anarasa flour made from finest rice, specially processed for making soft and delicious anarasa sweets.",
            Price = 120,
            Category = "Flour",
            Weight = "500g",
            ImageUrl = "/images/anarasa-flour.jpg"
        },
        new Product
        {
            Name = "Modak Pith",
            Description = "Ready-to-use modak pith (flour) for making perfect ukadiche modak. Fine texture ensures smooth and soft modak shells.",
            Price = 150,
            Category = "Flour",
            Weight = "500g",
            ImageUrl = "/images/modak-pith.jpg"
        },
        new Product
        {
            Name = "Ragi Flour",
            Description = "Nutritious ragi (finger millet) flour, rich in calcium and amino acids. Ideal for rotis, dosas, and healthy porridge.",
            Price = 95,
            Category = "Flour",
            Weight = "500g",
            ImageUrl = "/images/ragi-flour.jpg"
        },
        new Product
        {
            Name = "Sorghum Flour",
            Description = "Pure jowar (sorghum) flour, gluten-free and packed with nutrients. Perfect for making soft bhakri and healthy rotis.",
            Price = 75,
            Category = "Flour",
            Weight = "500g",
            ImageUrl = "/images/sorghum-flour.jpg"
        },
        new Product
        {
            Name = "Wheat Daliya",
            Description = "Coarsely ground whole wheat daliya (broken wheat), high in fiber and protein. Great for upma, kheer, and porridge.",
            Price = 65,
            Category = "Grains",
            Weight = "500g",
            ImageUrl = "/images/wheat-daliya.jpg"
        },
        new Product
        {
            Name = "Rice Flour",
            Description = "Finely ground pure rice flour for making crispy snacks, soft idlis, and traditional sweets. Gluten-free and versatile.",
            Price = 60,
            Category = "Flour",
            Weight = "500g",
            ImageUrl = "/images/rice-flour.jpg"
        },
        new Product
        {
            Name = "Buckwheat Flour",
            Description = "Pure kuttu (buckwheat) flour, perfect for fasting recipes. High in protein and essential minerals.",
            Price = 180,
            Category = "Flour",
            Weight = "500g",
            ImageUrl = "/images/buckwheat-flour.jpg"
        },
        new Product
        {
            Name = "Upvas Bhajani",
            Description = "Special fasting flour blend made from water chestnut, amaranth, and other upvas-friendly ingredients. Ready to use for thalipeeth.",
            Price = 160,
            Category = "Flour",
            Weight = "500g",
            ImageUrl = "/images/upvas-bhajani.jpg"
        },
        new Product
        {
            Name = "Ragi Malt (Sprouted)",
            Description = "Sprouted ragi malt powder, naturally sweet and highly nutritious. Perfect health drink for all ages, rich in calcium.",
            Price = 140,
            Category = "Health Mix",
            Weight = "500g",
            ImageUrl = "/images/ragi-malt.jpg"
        },
        new Product
        {
            Name = "Shingada Flour",
            Description = "Pure water chestnut (shingada) flour for fasting. Light, easy to digest, and perfect for puris and pakoras during vrat.",
            Price = 190,
            Category = "Flour",
            Weight = "250g",
            ImageUrl = "/images/shingada-flour.jpg"
        },
        new Product
        {
            Name = "Rajgira (Amaranth) Flour",
            Description = "Premium rajgira (amaranth) flour, rich in protein and minerals. Ideal for fasting recipes, rotis, and laddoos.",
            Price = 170,
            Category = "Flour",
            Weight = "250g",
            ImageUrl = "/images/rajgira-flour.jpg"
        },
        new Product
        {
            Name = "Chana Sattu",
            Description = "Roasted chana (gram) sattu powder, a traditional protein-rich superfood. Perfect for refreshing drinks, laddoos, and parathas.",
            Price = 110,
            Category = "Health Mix",
            Weight = "500g",
            ImageUrl = "/images/chana-sattu.jpg"
        }
    ];
}

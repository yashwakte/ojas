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
        },

        // The Powder Box range. Each entry carries the pack front as its main image and the
        // pack back in the gallery, so the detail page shows both faces - customers read
        // ingredients and directions off the back exactly as they would in a shop.
        //
        // Ingredients, directions and storage are transcribed from the printed packs rather than
        // written here. Nutrition is deliberately absent: the table printed on the custard packs
        // is self-contradictory (it lists fat in kcal and energy in grams), so publishing it
        // would put wrong figures on a food product. Add it once the artwork is corrected.
        new Product
        {
            Name = "Custard Powder - Vanilla Flavour",
            Description = "Classic vanilla custard - smooth, creamy and ready in minutes. Serve warm as a pudding or chilled over chopped fruit for a fruit custard the whole family will finish.",
            Price = 40,
            Category = "Powder Box",
            Weight = "100g",
            ImageUrl = "/images/custard-vanilla-front.webp",
            GalleryImageUrls = ["/images/custard-vanilla-back.webp"],
            Ingredients = "Selected edible starches, common salt, permitted synthetic food colours (INS 102, 110, 122) and artificial flavour (vanilla).",
            Benefits = "Dessert for four in about ten minutes, with nothing to measure but milk and sugar. Take 30 g (2 tablespoons) in a bowl. Add 125 ml milk from a 1/2 litre pouch and mix to a smooth paste. Boil the remaining 375 ml milk with 3/4 cup sugar, stir and remove from heat. Add the paste and cook 2-3 minutes, stirring continuously to avoid lumps. Cool, refrigerate 30-45 minutes, add chopped fruit and serve chilled.",
            StorageInfo = "Store in a cool, dry place. Once opened, keep in an airtight container."
        },
        new Product
        {
            Name = "Custard Powder - Mango Flavour",
            Description = "Ripe mango custard with the colour and aroma of an Alphonso summer. Delicious on its own and made for layering with fresh fruit and a little cream.",
            Price = 40,
            Category = "Powder Box",
            Weight = "100g",
            ImageUrl = "/images/custard-mango-front.webp",
            GalleryImageUrls = ["/images/custard-mango-back.webp"],
            Ingredients = "Selected edible starches, common salt, permitted synthetic food colours (INS 102, 110, 122) and artificial flavour (mango).",
            Benefits = "Dessert for four in about ten minutes, with nothing to measure but milk and sugar. Take 30 g (2 tablespoons) in a bowl. Add 125 ml milk from a 1/2 litre pouch and mix to a smooth paste. Boil the remaining 375 ml milk with 3/4 cup sugar, stir and remove from heat. Add the paste and cook 2-3 minutes, stirring continuously to avoid lumps. Cool, refrigerate 30-45 minutes, add chopped fruit and serve chilled.",
            StorageInfo = "Store in a cool, dry place. Once opened, keep in an airtight container."
        },
        new Product
        {
            Name = "Custard Powder - Strawberry Flavour",
            Description = "Soft pink strawberry custard, sweet and fragrant. A favourite with children, and the easiest way to turn a bowl of chopped fruit into dessert.",
            Price = 40,
            Category = "Powder Box",
            Weight = "100g",
            ImageUrl = "/images/custard-strawberry-front.webp",
            GalleryImageUrls = ["/images/custard-strawberry-back.webp"],
            Ingredients = "Selected edible starches, common salt, permitted synthetic food colours (INS 102, 110, 122) and artificial flavour (strawberry).",
            Benefits = "Dessert for four in about ten minutes, with nothing to measure but milk and sugar. Take 30 g (2 tablespoons) in a bowl. Add 125 ml milk from a 1/2 litre pouch and mix to a smooth paste. Boil the remaining 375 ml milk with 3/4 cup sugar, stir and remove from heat. Add the paste and cook 2-3 minutes, stirring continuously to avoid lumps. Cool, refrigerate 30-45 minutes, add chopped fruit and serve chilled.",
            StorageInfo = "Store in a cool, dry place. Once opened, keep in an airtight container."
        },
        new Product
        {
            Name = "Custard Powder - Pineapple Flavour",
            Description = "Bright, tangy pineapple custard that cuts through the sweetness of milk and sugar. Lovely chilled, with pineapple and pomegranate stirred through.",
            Price = 40,
            Category = "Powder Box",
            Weight = "100g",
            ImageUrl = "/images/custard-pineapple-front.webp",
            GalleryImageUrls = ["/images/custard-pineapple-back.webp"],
            Ingredients = "Selected edible starches, common salt, permitted synthetic food colours (INS 102, 110, 122) and artificial flavour (pineapple).",
            Benefits = "Dessert for four in about ten minutes, with nothing to measure but milk and sugar. Take 30 g (2 tablespoons) in a bowl. Add 125 ml milk from a 1/2 litre pouch and mix to a smooth paste. Boil the remaining 375 ml milk with 3/4 cup sugar, stir and remove from heat. Add the paste and cook 2-3 minutes, stirring continuously to avoid lumps. Cool, refrigerate 30-45 minutes, add chopped fruit and serve chilled.",
            StorageInfo = "Store in a cool, dry place. Once opened, keep in an airtight container."
        },
        new Product
        {
            Name = "Corn Flour",
            Description = "Finely ground corn (maize) flour - the kitchen workhorse for thickening. Gives soups, sauces and gravies body without dulling their flavour, crisps up a marinade, and keeps cakes light and tender.",
            Price = 25,
            Category = "Powder Box",
            Weight = "100g",
            ImageUrl = "/images/corn-flour-front.webp",
            GalleryImageUrls = ["/images/corn-flour-back.webp"],
            Ingredients = "Corn (maize) flour. Manufactured in a facility that also handles wheat, milk, soy and nuts.",
            Benefits = "Thickens without clouding the flavour, and keeps bakes light and tender. For 1 cup (250 ml) of soup or gravy, mix 1 heaped tablespoon (20 g) with a little cold water to a smooth slurry, stir out any lumps, then add it to the pan while stirring. Also used for puddings and creamy desserts and for a crisp marinade coating.",
            StorageInfo = "Store in a cool, dry place. Once opened, keep in an airtight container."
        }
    ];
}

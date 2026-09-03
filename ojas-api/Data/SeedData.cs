using OjasApi.Models;

namespace OjasApi.Data;

/// <summary>
/// The catalogue as it is printed on the packs.
///
/// Ingredients, nutrition, directions and storage are transcribed from the back of each pack
/// rather than written here, so the site says exactly what the packaging says. Weights and
/// prices are the printed net weight and MRP for the same reason — an online listing that
/// disagrees with the label is a consumer-protection problem, not a copy problem.
///
/// Where a printed figure is self-evidently wrong it is left out rather than repeated. The
/// custard nutrition table lists fat in kcal and energy in grams; the ragi malt table gives
/// calcium, iron and sodium in grams per 100 g, which would be most of the pack. Publishing
/// either would put false nutrition figures on a food product, so those specific numbers are
/// omitted and the rest of the panel is used. Add them once the artwork is corrected.
///
/// This only ever runs against an EMPTY products collection (see ProductService.SeedAsync).
/// Enriching products that already exist is ProductService.MigrateLegacyProductsAsync's job.
/// </summary>
public static class SeedData
{
    /// <summary>Printed on every pouch, verbatim apart from the shelf life, which varies.</summary>
    private static string PouchStorage(int months) =>
        "Contains no artificial additives or preservatives. Store in a cool, dry place and keep "
        + "away from direct sunlight. After opening the pack, transfer the contents to an airtight "
        + $"container. Best before {months} months from the date of packaging.";

    private const string BoxStorage =
        "Store in a cool, dry place. Once opened, keep in an airtight container.";

    private const string CustardMethod =
        "Dessert for four in about ten minutes, with nothing to measure but milk and sugar. Take "
        + "30 g (2 tablespoons) in a bowl. Add 125 ml milk from a 1/2 litre pouch and mix to a "
        + "smooth paste. Boil the remaining 375 ml milk with 3/4 cup sugar, stir and remove from "
        + "heat. Add the paste and cook 2-3 minutes, stirring continuously to avoid lumps. Cool, "
        + "refrigerate 30-45 minutes, add chopped fruit and serve chilled.";

    public static List<Product> GetProducts() =>
    [
        // ===== Everyday flours (500 g pouches) =====
        new Product
        {
            Name = "Sorghum Flour",
            Description = "Pure jowar (sorghum) flour, stone-ground for soft bhakri and everyday rotis. Naturally gluten-free and light to digest.",
            Price = 50,
            Category = "Flour",
            Weight = "500g",
            ImageUrl = "/images/sorghum-flour-front.webp",
            GalleryImageUrls = ["/images/sorghum-flour-back.webp"],
            Ingredients = "Sorghum (jowar).",
            Benefits = "Naturally gluten-free, and the traditional grain for bhakri across Maharashtra. Per 100 g: energy 371 kcal, protein 9.72 g, carbohydrate 75.51 g, total fat 3.45 g, sodium 40.35 mg.",
            StorageInfo = PouchStorage(4)
        },
        new Product
        {
            Name = "Bajra Flour",
            Description = "Premium bajra (pearl millet) flour, stone-ground for authentic taste. The warming winter grain, and the highest-protein flour in the range.",
            Price = 45,
            Category = "Flour",
            Weight = "500g",
            ImageUrl = "/images/bajra-flour-front.webp",
            GalleryImageUrls = ["/images/bajra-flour-back.webp"],
            Ingredients = "Bajra (pearl millet).",
            Benefits = "Rich in protein and iron, and traditionally eaten through the cold months for exactly that reason. Per 100 g: energy 387 kcal, protein 12.94 g, carbohydrate 77.7 g, total fat 4.54 g, sodium 8.0 mg.",
            StorageInfo = PouchStorage(4)
        },
        new Product
        {
            Name = "Ragi Flour",
            Description = "Nutritious ragi (finger millet) flour for rotis, dosas and porridge. The lightest flour in the range, and a good first grain for children.",
            Price = 50,
            Category = "Flour",
            Weight = "500g",
            ImageUrl = "/images/ragi-flour-front.webp",
            GalleryImageUrls = ["/images/ragi-flour-back.webp"],
            Ingredients = "Ragi (finger millet).",
            Benefits = "The lowest-energy flour here, and naturally gluten-free. Per 100 g: energy 336 kcal, protein 7.56 g, carbohydrate 72.26 g, total fat 1.9 g, sugar 0.6 g, sodium 9.22 mg.",
            StorageInfo = PouchStorage(4)
        },
        new Product
        {
            Name = "Rice Flour",
            Description = "Finely ground pure rice flour for crispy snacks, soft idlis and traditional sweets. Gluten-free and endlessly versatile.",
            Price = 50,
            Category = "Flour",
            Weight = "500g",
            ImageUrl = "/images/rice-flour-front.webp",
            GalleryImageUrls = ["/images/rice-flour-back.webp"],
            Ingredients = "Rice.",
            Benefits = "Gluten-free, very low in fat, and the base for everything from ghavan to chakli. Per 100 g: energy 353 kcal, protein 6.24 g, carbohydrate 79 g, total fat 1.3 g, sodium 1.25 mg.",
            StorageInfo = PouchStorage(6)
        },
        new Product
        {
            Name = "Modak Pith",
            Description = "Ready-to-use modak pith ground from aromatic rice, for ukadiche modak that steam soft and hold their pleats.",
            Price = 60,
            Category = "Flour",
            Weight = "500g",
            ImageUrl = "/images/modak-pith-front.webp",
            GalleryImageUrls = ["/images/modak-pith-back.webp"],
            Ingredients = "Aromatic rice flour.",
            Benefits = "For the shells: bring a bowl of water to the boil with a teaspoon of ghee and salt to taste, lower the flame, stir in an equal measure of modak pith, cover and rest a few minutes, then knead warm until smooth. Shape by hand or in a mould around a coconut-jaggery filling and steam about 5 minutes. Serve hot with ghee. If the dough sticks, oil your palms; if the filling is loose, a spoonful of the pith will thicken it. Per 100 g: energy 360.3 kcal, protein 12.5 g, carbohydrate 80.1 g, total fat 0.90 g, sodium 0 mg.",
            StorageInfo = PouchStorage(6)
        },
        new Product
        {
            Name = "Anarasa Flour",
            Description = "Traditional anarasa flour of rice and jaggery, ready for the crisp, poppy-seed-topped Diwali sweet.",
            Price = 115,
            Category = "Flour",
            Weight = "500g",
            ImageUrl = "/images/anarasa-flour-front.webp",
            GalleryImageUrls = ["/images/anarasa-flour-back.webp"],
            Ingredients = "Rice flour, jaggery.",
            Benefits = "Already sweetened, so there is nothing to soak or grind. Take 500 g and add milk a little at a time until the dough is soft. Roll small balls, press each onto khaskhas and flatten slightly. Fry on a medium flame poppy-seed side up until reddish. Per 100 g: energy 367.2 kcal, protein 9.21 g, carbohydrate 79.8 g, total fat 1.32 g, sodium 1.5 mg.",
            StorageInfo = PouchStorage(6)
        },
        new Product
        {
            Name = "Wheat Daliya",
            Description = "Coarsely ground whole wheat daliya (broken wheat) for khichdi, upma and kheer. High in fibre and protein.",
            Price = 45,
            Category = "Grains",
            Weight = "500g",
            ImageUrl = "/images/wheat-daliya-front.webp",
            GalleryImageUrls = ["/images/wheat-daliya-back.webp"],
            Ingredients = "Wheat.",
            Benefits = "The highest-protein item in the everyday range, and a whole grain rather than a flour, so it digests slowly. For daliya khichdi: soak a bowl of daliya with half a bowl of moong dal for 20-25 minutes, roast in ghee in a cooker until golden, add dal, onion and tomato and cook a couple of minutes, season with turmeric, salt and hing, add four times the water and cook to two whistles. Finish with a tempering of cumin, garlic, ginger and green chilli. Per 100 g: energy 372 kcal, protein 14.58 g, carbohydrate 73.26 g, total fat 2.36 g, sodium 6.23 mg.",
            StorageInfo = PouchStorage(6)
        },

        // ===== Health mixes (200 g pouches) =====
        new Product
        {
            Name = "Chana Sattu",
            Description = "Roasted chana (Bengal gram) sattu with cumin - a traditional protein-rich cooler that mixes straight into water.",
            Price = 50,
            Category = "Health Mix",
            Weight = "200g",
            ImageUrl = "/images/chana-sattu-front.webp",
            GalleryImageUrls = ["/images/chana-sattu-back.webp"],
            Ingredients = "Roasted Bengal gram, cumin seed.",
            Benefits = "21 g of protein and 14 g of fibre per 100 g, with no cooking at all. As a drink: stir 3 tsp into a glass of water, add salt or sugar to taste and a squeeze of lemon. As a food: mix three heaped teaspoons with water or milk to a dough. Per 100 g: energy 400.10 kcal, protein 21.22 g, carbohydrate 63.12 g, total fat 6.10 g, dietary fibre 14.10 g, sodium 8.50 mg, calcium 10.13 mg.",
            StorageInfo = PouchStorage(6)
        },
        new Product
        {
            Name = "Ragi Malt (Sprouted)",
            Description = "Sprouted ragi malt with cardamom, lightly sweetened. A gentle daily porridge for children from six months and for everyone else.",
            Price = 65,
            Category = "Health Mix",
            Weight = "200g",
            ImageUrl = "/images/ragi-malt-front.webp",
            GalleryImageUrls = ["/images/ragi-malt-back.webp"],
            Ingredients = "Ragi (sprouted), sugar, cardamom.",
            Benefits = "Sprouting the ragi before milling is what makes it easy on a young stomach, and it is a source of calcium and iron. For porridge, whisk 1-2 tbsp lump-free into a cup of milk and cook on a medium flame for 3-5 minutes, stirring continuously. Serve warm. Suggested serving: 1 tbsp (10 g) from six months to two years, 2 tbsp (15 g) from two years upward. Per 100 g: energy 366 kcal, protein 14 g, carbohydrate 74.35 g, total fat 1.44 g, of which sugars 22.10 g.",
            StorageInfo = PouchStorage(6)
        },

        // ===== Upwas / fasting range (200 g pouches) =====
        new Product
        {
            Name = "Rajgira (Amaranth) Flour",
            Description = "Premium rajgira (amaranth) flour for fasting days - thalipeeth, puris and laddoos. Rich in protein and minerals.",
            Price = 60,
            Category = "Upwas",
            Weight = "200g",
            ImageUrl = "/images/rajgira-flour-front.webp",
            GalleryImageUrls = ["/images/rajgira-flour-back.webp"],
            Ingredients = "Rajgira (amaranth).",
            Benefits = "14 g of protein per 100 g, which is unusual for a fasting flour, and grain-free. For rajgira thalipeeth: mix 100 g with crushed groundnut, grated boiled potato, chopped green chilli and salt, add water and knead. Pat a ball flat on a plastic sheet, cook on a lightly greased non-stick tawa covered for 1-2 minutes, then turn and crisp the other side. Good with butter, curd or upvas chutney. Per 100 g: energy 315 kcal, protein 14.20 g, carbohydrate 60 g, total fat 1.90 g.",
            StorageInfo = PouchStorage(6)
        },
        new Product
        {
            Name = "Buckwheat Flour",
            Description = "Pure kuttu (buckwheat) flour for fasting puris and parathas. High in protein and one of the few plant foods rich in lysine.",
            Price = 65,
            Category = "Upwas",
            Weight = "200g",
            ImageUrl = "/images/buckwheat-flour-front.webp",
            GalleryImageUrls = ["/images/buckwheat-flour-back.webp"],
            Ingredients = "Kuttu (buckwheat).",
            Benefits = "Packed with high-quality protein, and it offers more of the amino acid lysine than wheat and rice do - which is a real plus on a vegetarian diet. Loaded with fibre, so it keeps hunger pangs at bay. Makes puris, parathas and most other fasting dishes. Per 100 g: energy 340 kcal, protein 13.20 g, carbohydrate 72 g, total fat 3.2 g.",
            StorageInfo = PouchStorage(6)
        },
        new Product
        {
            Name = "Shingada Flour",
            Description = "Pure water chestnut (shingada) flour for vrat. Light, easy to digest, and the traditional base for upvas shira and puris.",
            Price = 100,
            Category = "Upwas",
            Weight = "200g",
            ImageUrl = "/images/shingada-flour-front.webp",
            GalleryImageUrls = ["/images/shingada-flour-back.webp"],
            Ingredients = "Shingada (water chestnut).",
            Benefits = "Very low in fat, high in potassium, and the lightest of the fasting flours. For shingada shira: warm ghee in a wide non-stick pan, add the flour and roast on a low flame for about 4 minutes until it turns lightly brown, stirring constantly. Add 2 cups warm water, mix well and cook until absorbed, then add sugar and cook 4 minutes more. Finish with cardamom and dry fruit. Per 100 g: energy 348 kcal, protein 7.90 g, carbohydrate 69.08 g, total fat 1.02 g, dietary fibre 6.95 g, sodium 54.25 mg, potassium 172 mg.",
            StorageInfo = PouchStorage(6)
        },
        new Product
        {
            Name = "Upvas Bhajani",
            Description = "A ready fasting blend of rajgira, bhagar, sabudana and jeera - thalipeeth without measuring out four flours.",
            Price = 60,
            Category = "Upwas",
            Weight = "200g",
            ImageUrl = "/images/upvas-bhajani-front.webp",
            GalleryImageUrls = ["/images/upvas-bhajani-back.webp"],
            Ingredients = "Rajgira, bhagar, sabudana, jeera.",
            Benefits = "Four fasting staples already balanced and roasted, so a thalipeeth takes one bowl instead of four packets. Boil and mash 2-3 potatoes, mix 100 g of the bhajani with crushed groundnut, the potato, chopped green chilli and salt, add water and knead. Pat flat on a plastic sheet, cook covered on a greased tawa for 1-2 minutes a side. Serve with butter, curd or upvas chutney. Per 100 g: energy 358 kcal, protein 11 g, carbohydrate 73.8 g, total fat 2 g.",
            StorageInfo = PouchStorage(6)
        },

        // ===== Powder Box range =====
        // Each entry carries the pack front as its main image and the pack back in the gallery,
        // so the detail page shows both faces - customers read ingredients and directions off the
        // back exactly as they would in a shop.
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
            Benefits = CustardMethod,
            StorageInfo = BoxStorage
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
            Benefits = CustardMethod,
            StorageInfo = BoxStorage
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
            Benefits = CustardMethod,
            StorageInfo = BoxStorage
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
            Benefits = CustardMethod,
            StorageInfo = BoxStorage
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
            StorageInfo = BoxStorage
        }
    ];
}

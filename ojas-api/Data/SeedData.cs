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
        },

        // ===== Awaiting the owner's prices =====
        //
        // Photographed, transcribed off the back of the pack, and deliberately NOT on sale: every
        // product below carries Price = 0 and IsListed = false, so the storefront never shows it
        // and no customer can ever be charged a price the owner did not set. They are here rather
        // than absent so the owner has something to open, price and publish in the admin console
        // instead of retyping a pack's whole label from scratch.
        //
        // Publishing one is two fields in the admin console: set the price, tick Listed.

        // ----- Kitchen-essentials cartons -----
        new Product
        {
            Name = "Baking Powder",
            Description = "Highly pure baking powder for everyday baking - cakes, pancakes, quick breads and other baked mixtures. No anticaking agent added.",
            Price = 0,
            IsListed = false,
            IsAvailable = false,
            Category = "Powder Box",
            Weight = "50g",
            ImageUrl = "/images/baking-powder-front.webp",
            GalleryImageUrls = ["/images/baking-powder-back.webp"],
            Ingredients = "Baking powder. Contains no common allergens such as gluten, nuts, soy, dairy or eggs.",
            Benefits = "The raising agent for cakes, pancakes, quick breads and other baked mixtures. Per 100 g: sodium 330 mg, calcium 252 mg.",
            StorageInfo = "Store in a cool, hygienic and dry place. Keep away from sunlight. Do not consume if the pack is unsealed. Best before 12 months from packing."
        },
        new Product
        {
            Name = "Baking Soda",
            Description = "Highly pure baking soda (sodium bicarbonate) for baking and around the house. Lump formation is natural - no anticaking agent has been added.",
            Price = 0,
            IsListed = false,
            IsAvailable = false,
            Category = "Powder Box",
            Weight = "100g",
            ImageUrl = "/images/baking-soda-front.webp",
            GalleryImageUrls = ["/images/baking-soda-back.webp"],
            Ingredients = "Baking soda (sodium bi-carbonate). Contains no common allergens such as gluten, nuts, soy, dairy or eggs.",
            Benefits = "Beyond baking: exfoliates skin and clears clogged pores, soothes an itchy scalp, whitens teeth used sparingly, temporarily neutralises acid reflux when diluted, and works as a natural deodorant or foot soak.",
            StorageInfo = "Store in a cool, dry and hygienic place. Keep away from direct sunlight."
        },
        new Product
        {
            Name = "Rock Salt",
            Description = "Premium pink rock salt (sendha namak) for daily cooking - one of the purest salts there is, and the salt traditionally eaten during a fast.",
            Price = 0,
            IsListed = false,
            IsAvailable = false,
            Category = "Powder Box",
            Weight = "100g",
            ImageUrl = "/images/rock-salt-front.webp",
            GalleryImageUrls = ["/images/rock-salt-back.webp"],
            Ingredients = "Premium pink rock salt. Contains iodine. Allergy advice: contains tree nuts.",
            Benefits = "A premium grade pink rock salt for the finest gourmet food preparation, and one of the purest salts, providing minerals essential for your body. Per 100 g: sodium 24 g.",
            StorageInfo = "Store in a cool, dry and hygienic place. Keep away from direct sunlight. Once opened, keep the product in an airtight container."
        },
        new Product
        {
            Name = "Black Salt",
            Description = "Premium black salt (kala namak) - the sulphurous, faintly smoky salt that finishes chaat, raita, buttermilk and cut fruit.",
            Price = 0,
            IsListed = false,
            IsAvailable = false,
            Category = "Powder Box",
            Weight = "100g",
            ImageUrl = "/images/black-salt-front.webp",
            Ingredients = "Premium black salt (kala namak).",
            Benefits = "The finishing salt for chaat, raita, buttermilk and cut fruit, where its sulphurous note is the whole point.",
            StorageInfo = "Store in a cool, dry and hygienic place. Keep away from direct sunlight. Once opened, keep the product in an airtight container."
        },
        new Product
        {
            Name = "Cocoa Powder",
            Description = "Unsweetened cocoa powder, 99.75% cocoa solids, for baking, hot chocolate and chocolate sauce.",
            Price = 0,
            IsListed = false,
            IsAvailable = false,
            Category = "Powder Box",
            Weight = "25g",
            ImageUrl = "/images/cocoa-powder-front.webp",
            GalleryImageUrls = ["/images/cocoa-powder-back.webp"],
            Ingredients = "Cocoa solids 99.75%, added flavour (nature identical and artificial flavouring substance - chocolate). May contain milk, nuts and mustard.",
            Benefits = "For a rich chocolate sauce: mix 15 g cocoa powder, 15 g corn flour, 30 g sugar and 15 g butter with 300 ml milk to a smooth paste, then boil to thicken, stirring continuously.",
            StorageInfo = "Store in a cool, dry and hygienic place. Keep away from direct sunlight. Once opened, keep the product in an airtight container."
        },
        new Product
        {
            Name = "Citric Acid",
            Description = "Citric acid (limbu satva) - the sharpener for soft drinks, squashes, jams, jellies, instant dhokla, idli and dosa.",
            Price = 0,
            IsListed = false,
            IsAvailable = false,
            Category = "Powder Box",
            Weight = "25g",
            ImageUrl = "/images/citric-acid-front.webp",
            GalleryImageUrls = ["/images/citric-acid-back.webp"],
            Ingredients = "Citric acid. May contain traces of wheat (gluten), milk and nuts.",
            Benefits = "Used in soft drinks, fruit squashes, sauces, jams, jellies, instant dhokla, instant idli and instant dosa, and as a fruit salt with baking soda. For relief from acidity and heartburn: take a glass of water, add half a teaspoon of citric acid and one teaspoon of sodium bicarbonate, stir and drink.",
            StorageInfo = "Store in a cool and dry place. Once opened, transfer to an airtight container. Do not buy if the packet is damaged or tampered with. Best before 12 months from the date of packing."
        },
        new Product
        {
            Name = "Monosodium Glutamate",
            Description = "Monosodium glutamate (MSG, E621) - the flavour enhancer that adds savoury depth to soups, sauces, seasonings and instant snacks.",
            Price = 0,
            IsListed = false,
            IsAvailable = false,
            Category = "Powder Box",
            Weight = "25g",
            ImageUrl = "/images/monosodium-glutamate-front.webp",
            GalleryImageUrls = ["/images/monosodium-glutamate-back.webp"],
            Ingredients = "Monosodium glutamate (MSG, INS 621). May contain traces of wheat (gluten), milk and nuts. Not to be added to any food meant for infants below 2 years.",
            Benefits = "Adds flavour to soups, sauces, seasonings and instant snacks. A taste enhancer, imparting the savoury sixth sense described as umami, alongside sweet, spicy, bitter, sour and salty. May be added at any stage of cooking.",
            StorageInfo = "Store in a cool and dry place. Once opened, transfer to an airtight container. Do not buy if the packet is damaged or tampered with. Best before 12 months from the date of packing."
        },
        new Product
        {
            Name = "Dry Ginger Powder",
            Description = "Dry ginger powder (sunth) - woody notes with a sweet undertone, hot and pungent, at home in most curries and Indian dishes.",
            Price = 0,
            IsListed = false,
            IsAvailable = false,
            Category = "Powder Box",
            Weight = "25g",
            ImageUrl = "/images/dry-ginger-powder-front.webp",
            GalleryImageUrls = ["/images/dry-ginger-powder-back.webp"],
            Ingredients = "Ground dry ginger. May contain traces of wheat (gluten), milk and nuts. No preservatives, no added colours or flavours.",
            Benefits = "Packs in the goodness of the oriental spice that makes it a base addition in most curries and Indian dishes. Per 100 g: energy 335 kcal, protein 4 g, carbohydrate 67 g, fibre 12 g, calcium 110 mg, iron 19 mg.",
            StorageInfo = "Store in a cool and dry place. Once opened, transfer to an airtight container. Do not buy if the packet is damaged or tampered with. Best before 12 months from the date of packing."
        },
        new Product
        {
            Name = "Cinnamon Powder",
            Description = "Natural cinnamon (dalchini) powder, finely ground - a spice and a folk medicine both, and one of the warmest things you can put in a bake.",
            Price = 0,
            IsListed = false,
            IsAvailable = false,
            Category = "Powder Box",
            Weight = "25g",
            ImageUrl = "/images/cinnamon-powder-front.webp",
            GalleryImageUrls = ["/images/cinnamon-powder-back.webp"],
            Ingredients = "Cinnamon (dalchini). May contain traces of wheat (gluten), milk and nuts.",
            Benefits = "Used for centuries as a spice and a folk medicine for cough and sore throat. Improves digestion, boosts immunity, has anti-inflammatory properties and is loaded with antioxidants. Per 100 g: energy 375 kcal, protein 3.9 g, carbohydrate 77.2 g, fat 22.7 g, sodium 3 g.",
            StorageInfo = "Store in a cool and dry place. Once opened, transfer to an airtight container. Do not buy if the packet is damaged or tampered with. Best before 12 months from the date of packing."
        },
        new Product
        {
            Name = "Jeshthamadh (Sweet Root) Powder",
            Description = "Jeshthamadh - mulethi, or liquorice root - finely ground from carefully selected dried roots, with no preservatives, colours or additives.",
            Price = 0,
            IsListed = false,
            IsAvailable = false,
            Category = "Powder Box",
            Weight = "25g",
            ImageUrl = "/images/jeshthamadh-powder-front.webp",
            GalleryImageUrls = ["/images/jeshthamadh-powder-back.webp"],
            Ingredients = "Jeshthamadh (sweet root) powder. May contain traces of wheat (gluten), milk and nuts. No added preservatives, colours or additives.",
            Benefits = "Also known as mulethi, a natural herbal ingredient widely used in traditional wellness practices. Add half a teaspoon to warm water or milk, use in herbal teas (kadha), mix with honey for throat soothing, or use in Ayurvedic preparations.",
            StorageInfo = "Store in a cool and dry place. Once opened, transfer to an airtight container. Do not buy if the packet is damaged or tampered with. Best before 9 months from the date of packing."
        },
        new Product
        {
            Name = "Active Dry Yeast",
            Description = "Active dry yeast, crafted for perfect baking - for bread, rolls, cakes and any type of risen bread, naan or roti.",
            Price = 0,
            IsListed = false,
            IsAvailable = false,
            Category = "Powder Box",
            Weight = "25g",
            ImageUrl = "/images/active-dry-yeast-front.webp",
            GalleryImageUrls = ["/images/active-dry-yeast-back.webp"],
            Ingredients = "Yeast, sorbitan monostearate (INS 491), ascorbic acid (INS 300). May contain traces of wheat (gluten), milk and nuts.",
            Benefits = "To activate: measure the water called for in the recipe into a measuring cup, lukewarm at about 32-43 degrees C - warm on the wrist, never hot enough to burn. Add a pinch of sugar, stir the yeast in vigorously and cover for ten minutes. When it is bubbly and foamy it is active and ready to use. Per 100 g: energy 333 kcal, protein 45 g, carbohydrate 34 g.",
            StorageInfo = "Store in a cool and dry place. Once opened, transfer to an airtight container. Do not buy if the packet is damaged or tampered with. Best before 12 months from the date of packing."
        },

        // ----- Pouches -----
        new Product
        {
            Name = "Amboli (Ghavan) Flour",
            Description = "Ready flour for amboli and ghavan - the soft, lacy Konkani rice pancake, fermented overnight and eaten with coconut chutney.",
            Price = 0,
            IsListed = false,
            IsAvailable = false,
            Category = "Flour",
            Weight = "200g",
            ImageUrl = "/images/amboli-flour-front.webp",
            Ingredients = "Rice flour blend for amboli and ghavan.",
            Benefits = "Tasty, crisp and nutritious - the Konkani breakfast pancake with nothing to grind or blend at home.",
            StorageInfo = PouchStorage(6)
        },
        new Product
        {
            Name = "Thalipeeth Bhajani",
            Description = "Thalipeeth multigrain flour with millet - the roasted, spiced Maharashtrian blend that makes a thalipeeth in minutes.",
            Price = 0,
            IsListed = false,
            IsAvailable = false,
            Category = "Flour",
            Weight = "200g",
            ImageUrl = "/images/thalipeeth-bhajani-front.webp",
            Ingredients = "Roasted multigrain blend with millet.",
            Benefits = "Tasty, crisp and nutritious, and rich in fibre. One flour, one pan, and breakfast is done.",
            StorageInfo = PouchStorage(6)
        },
        new Product
        {
            Name = "Bhagar (Varai) Peeth",
            Description = "Little millet (bhagar, varai) flour with sago - the fasting flour for upvas thalipeeth and bhakri, ready to use.",
            Price = 0,
            IsListed = false,
            IsAvailable = false,
            Category = "Upwas",
            Weight = "500g",
            ImageUrl = "/images/bhagar-peeth-front.webp",
            GalleryImageUrls = ["/images/bhagar-peeth-back.webp"],
            Ingredients = "Little millet (varai) flour, sago flour.",
            Benefits = "Fasting-friendly and ready to use: the upvas thalipeeth flour without soaking, drying and grinding varai at home.",
            StorageInfo = PouchStorage(6)
        }
    ];
}

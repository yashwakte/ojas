import { ProductCategory } from './product-categories';

export interface Season {
  festival: string;
  marathi: string;
  dish: string;
  /** What we grind for it. Only products that are really in the catalogue are named here. */
  made: string;
  category: ProductCategory;
  icon: string;
  tone: 'saffron' | 'sage' | 'rose' | 'amber' | 'sky';
}

/**
 * The Maharashtrian kitchen runs on its calendar, and so does most of what Ojas sells: modak pith
 * sells in Ganeshotsav, the upwas flours in Navratri and Shravan, anarse pith before Diwali.
 * Telling a customer which flour belongs to which festival is the part of the shop they
 * recognise their own kitchen in.
 */
export const SEASONS: readonly Season[] = [
  {
    festival: 'Ganeshotsav',
    marathi: 'गणेशोत्सव',
    dish: 'Ukadiche modak for Bappa',
    made: 'Modak pith',
    category: 'Traditional & Festive',
    icon: 'celebration',
    tone: 'saffron',
  },
  {
    festival: 'Navratri & Ekadashi',
    marathi: 'उपवास',
    dish: 'Upwasache thalipeeth and rajgira puri',
    made: 'Rajgira, shingada & bhajani',
    category: 'Upwas',
    icon: 'self_improvement',
    tone: 'sage',
  },
  {
    festival: 'Diwali',
    marathi: 'दिवाळी',
    dish: 'Anarse for the faral plate',
    made: 'Anarse pith',
    category: 'Traditional & Festive',
    icon: 'auto_awesome',
    tone: 'rose',
  },
  {
    festival: 'Makar Sankranti',
    marathi: 'मकर संक्रांत',
    dish: 'Bajrichi bhakri with til on Bhogi',
    made: 'Bajri pith',
    category: 'Everyday Flours',
    icon: 'wb_sunny',
    tone: 'amber',
  },
  {
    festival: 'Summer',
    marathi: 'उन्हाळा',
    dish: 'A cooling glass of sattu',
    made: 'Chana sattu',
    category: 'Health & Nutrition',
    icon: 'local_drink',
    tone: 'sky',
  },
];

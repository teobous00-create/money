import {
  Wallet, CreditCard, Landmark, PiggyBank, Bitcoin, Heart, House, ShoppingBasket, ShoppingCart, Smartphone,
  AppWindow, PartyPopper, CarTaxiFront, TramFront, Stethoscope, Pill, Shirt, TreePalm, ChartCandlestick, Sprout,
  Handshake, Briefcase, Coins, TrendingUp, Gift, Users, Beer, Coffee, Utensils, Cigarette, PawPrint, Zap, Droplet,
  Wifi, Sofa, Plane, Bus, Car, Fuel, Book, GraduationCap, Dumbbell, Music, Film, Gamepad2, Baby, Scissors, Wrench,
  Receipt, Banknote, Vault, Star, Target, Bike, Shield, Circle, Pizza, Cake, Wine, Train, HandCoins, Building2, Gem,
  Ticket, Laptop, Tv, Phone, Cat, Flower2, Hammer, Sparkles, Smile, Bath, Candy, Package, BadgePercent,
  type LucideIcon,
} from 'lucide-react';

export const ICONS: Record<string, LucideIcon> = {
  wallet: Wallet, card: CreditCard, bank: Landmark, piggy: PiggyBank, vault: Vault, bitcoin: Bitcoin, coins: Coins,
  banknote: Banknote, handcoins: HandCoins, trending: TrendingUp, candles: ChartCandlestick, gem: Gem, heart: Heart,
  house: House, basket: ShoppingBasket, cart: ShoppingCart, package: Package, sofa: Sofa, zap: Zap, droplet: Droplet,
  wifi: Wifi, phone: Phone, smartphone: Smartphone, app: AppWindow, laptop: Laptop, tv: Tv,
  coffee: Coffee, utensils: Utensils, pizza: Pizza, cake: Cake, candy: Candy, beer: Beer, wine: Wine, cigarette: Cigarette,
  party: PartyPopper, ticket: Ticket, film: Film, music: Music, game: Gamepad2, gift: Gift, smile: Smile, sparkles: Sparkles,
  taxi: CarTaxiFront, tram: TramFront, train: Train, bus: Bus, car: Car, fuel: Fuel, bike: Bike, plane: Plane, palm: TreePalm,
  doctor: Stethoscope, pill: Pill, bath: Bath, dumbbell: Dumbbell, scissors: Scissors, shirt: Shirt, baby: Baby,
  paw: PawPrint, cat: Cat, flower: Flower2, sprout: Sprout, book: Book, school: GraduationCap,
  briefcase: Briefcase, building: Building2, handshake: Handshake, users: Users, receipt: Receipt, percent: BadgePercent,
  wrench: Wrench, hammer: Hammer, shield: Shield, star: Star, target: Target, circle: Circle,
};

export const ICON_NAMES = Object.keys(ICONS).filter(n => n !== 'circle');

export const COLORS = [
  '#E5484D', '#F76B15', '#E8A33D', '#C9A227', '#7CB342', '#30A46C', '#12A594', '#0E9DB3',
  '#3E63DD', '#5B5BD6', '#8E4EC6', '#D6409F', '#8D6E63', '#64748B', '#334155', '#A1887F',
];

// Keyword → [icon, color]. Matched against lower-cased names (Greek and English).
const RULES: Array<[RegExp, string, string]> = [
  [/μετρητ|cash/, 'wallet', '#64748B'],
  [/κομοδ|vault|θυρίδ/, 'vault', '#64748B'],
  [/πιστωτ|credit|amex|visa/, 'card', '#E5484D'],
  [/joint|κοιν/, 'heart', '#D6409F'],
  [/savings|οικονομ|ταμιευ|fund|σιδεράκ/, 'piggy', '#8E4EC6'],
  [/btc|bitcoin|eth|solana|cardano|xrp|tron|near|aave|jito|cronos|crypto|nexo/, 'bitcoin', '#F76B15'],
  [/vuaa|qqq|2b76|google|robo|invest|wealth|ultima|eightcup|ετf|etf|μετοχ/, 'trending', '#30A46C'],
  [/μηχαν|moto|bike/, 'bike', '#E8A33D'],
  [/tattoo/, 'sparkles', '#334155'],
  [/παπούτσ|shoe/, 'shirt', '#8D6E63'],
  [/δάνει|δανει|loan|χρωστ/, 'handshake', '#F76B15'],
  [/eurobank|πειραι|alpha|εθνικ|bank|revolut|τράπεζ/, 'bank', '#3E63DD'],
  [/supermarket|σούπερ|αναγκαία|groc/, 'basket', '#3E63DD'],
  [/super b|drinks|ποτ/, 'beer', '#E8A33D'],
  [/καφ|coffee/, 'coffee', '#8D6E63'],
  [/γλυκ|cake|sweet/, 'cake', '#D6409F'],
  [/τσιγάρ|cigar/, 'cigarette', '#64748B'],
  [/υγιειν|bath/, 'bath', '#0E9DB3'],
  [/σπίτι|σπιτι|home|house/, 'house', '#E5484D'],
  [/delivery|φαγητ|food|εστιατ/, 'utensils', '#F76B15'],
  [/ενοίκ|rent/, 'building', '#5B5BD6'],
  [/έπιπλ|επιπλ|furnit/, 'sofa', '#8D6E63'],
  [/ίντερνετ|internet|wifi/, 'wifi', '#0E9DB3'],
  [/δεη|ρεύμα|electric/, 'zap', '#E8A33D'],
  [/ευδαπ|νερό|water/, 'droplet', '#0E9DB3'],
  [/σκύλ|γάτ|dog|cat|pet/, 'paw', '#A1887F'],
  [/στόχ|goal/, 'target', '#30A46C'],
  [/κινητ|cosmote|vodafone|nova|mobile/, 'smartphone', '#12A594'],
  [/εφαρμογ|apps?|claude|spotify|tradingview|opendrive|upwork|fiverr|netflix/, 'app', '#5B5BD6'],
  [/διασκέδ|διασκεδ|fun|entert/, 'party', '#D6409F'],
  [/δώρο|gift/, 'gift', '#D6409F'],
  [/κέρασμ/, 'handcoins', '#E8A33D'],
  [/μεταφορ|transport/, 'taxi', '#F76B15'],
  [/μετρό|metro/, 'tram', '#3E63DD'],
  [/ταξί|taxi/, 'taxi', '#E8A33D'],
  [/ιατρ|γιατρ|doctor|medic/, 'doctor', '#E5484D'],
  [/φαρμακ|pharm/, 'pill', '#C9A227'],
  [/ρούχ|clothes/, 'shirt', '#7CB342'],
  [/διακοπ|holiday|vacat|travel/, 'palm', '#12A594'],
  [/trading|copy|funded/, 'candles', '#7CB342'],
  [/ανάπτυξ|growth|βιβλί|book/, 'sprout', '#C9A227'],
  [/σεμινάρ|course|μάθημ/, 'school', '#5B5BD6'],
  [/μισθ|salary|cake & roll|pda|lions/, 'briefcase', '#30A46C'],
  [/tips|φιλοδ/, 'coins', '#C9A227'],
  [/νερόμυλ|ξενοδοχ|πάρκο|hotel/, 'building', '#12A594'],
  [/επίδομ|benefit/, 'gift', '#8E4EC6'],
  [/συνεδρ|session/, 'users', '#D6409F'],
  [/άλλα|other/, 'receipt', '#64748B'],
];

export function guessStyle(name: string, fallbackIndex = 0): { icon: string; color: string } {
  const n = name.toLowerCase();
  for (const [re, icon, color] of RULES) if (re.test(n)) return { icon, color };
  return { icon: 'circle', color: COLORS[fallbackIndex % COLORS.length] };
}

/** Soft background tint for a solid color. */
export function tint(hex: string, alpha = 0.14): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

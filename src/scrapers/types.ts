export interface MenuItem {
  category?: string;
  name: string;
  price?: string;
}

export interface RestaurantMenu {
  restaurant: string;
  items: MenuItem[];
  available: boolean;
  /** Optional note, e.g. "menú no disponible todavía" or error info */
  note?: string;
}

export interface Scraper {
  name: string;
  fetchMenu(): Promise<RestaurantMenu>;
}

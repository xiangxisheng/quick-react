/** 首页内容由后端下发：外部身份源要求首页说明应用的用途。 */
export type HomeSection = { key: string; title: string; body: string };
export type HomeLink = { key: string; label: string; url: string };

export type HomePageData = {
	title: string;
	summary: string;
	sections: HomeSection[];
	links: HomeLink[];
};

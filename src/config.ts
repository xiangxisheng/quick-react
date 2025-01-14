
const route = {
    "name": "",
    "path": "/",
    "component": "common/index",
    "children": [
        {
            "name": "404",
            "path": "/:pathMatch(.*)",
            "component": "common/404"
        },
        {
            "name": "console",
            "label": "menu.console",
            "component": "common/panel",
            "role": "user",
            "children": [
                {
                    "name": "system",
                    "label": "menu.system",
                    "role": "sysadmin",
                    "children": [
                        {
                            "name": "i18n_data",
                            "label": "menu.language_setting",
                            "component": "common/table",
                            "role": "sysadmin"
                        },
                        {
                            "name": "roles",
                            "label": "menu.roles",
                            "component": "common/table",
                            "role": "sysadmin"
                        },
                        {
                            "name": "users",
                            "label": "menu.users",
                            "component": "common/table",
                            "role": "sysadmin",
                            "alias": "/"
                        },
                    ],
                },
            ],
        },
        {
            "name": "register",
            "label": "sign.register",
            "component": "common/form",
            "role": "public"
        },
        {
            "name": "login",
            "label": "sign.login",
            "component": "common/form",
            "role": "public"
        },
        {
            "name": "logout",
            "role": "public"
        },
    ],
};

export interface Route {
    name: string
    path?: string
    component?: string
    children?: Route[]
    label?: string
    role?: string
}

export interface Config {
    routes: Route[]
}

export const config: Config = {
    routes: [route],
};


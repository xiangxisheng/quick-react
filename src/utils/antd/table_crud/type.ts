
interface ResJsonTableColumnRule {
    required: boolean;
    message: string;
}

interface SelectOption {
    value: string;
    text: string;
}

interface ResJsonTableColumn {
    dataIndex: string;
    title: string;
    form?: string;
    rules?: ResJsonTableColumnRule[];
    ellipsis?: boolean;
    placeholder?: string;
    options?: SelectOption[];
}

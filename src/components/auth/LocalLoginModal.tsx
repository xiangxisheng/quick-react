import { Modal } from 'antd';
import type { CommonApi } from '@/utils/common/api.js';
import FormPage from '@/components/panel/FormPage.js';

type LocalLoginModalProps = {
	open: boolean;
	onClose: () => void;
	commonApi: CommonApi;
	apiSuffix: string;
};

/** 本地登录也使用后端下发的通用 FormPage，只改变容器为弹窗。 */
export default function LocalLoginModal({ open, onClose, commonApi, apiSuffix }: LocalLoginModalProps) {
	return <Modal open={open} footer={null} onCancel={onClose} destroyOnHidden width={520}>
		<FormPage
			commonApi={commonApi}
			apiPath={`/api/sign${apiSuffix}`}
			title="登录"
			submitMethod="POST"
			onCompleted={onClose}
		/>
	</Modal>;
}

import React, { useEffect, useState } from 'react';

export const formatCountdown = (value: string | number) => Math.max(0, Number(value) / 1000).toFixed(1);

export const CountdownDisplay = ({ deadline, onFinish }: { deadline: number; onFinish: () => void }) => {
	const [remaining, setRemaining] = useState(() => Math.max(0, deadline - Date.now()));

	useEffect(() => {
		let finished = false;
		const timer = window.setInterval(() => {
			const next = Math.max(0, deadline - Date.now());
			setRemaining(next);
			if (next === 0 && !finished) {
				finished = true;
				window.clearInterval(timer);
				onFinish();
			}
		}, 100);
		return () => window.clearInterval(timer);
	}, [deadline, onFinish]);

	return <span>{formatCountdown(remaining)}</span>;
};

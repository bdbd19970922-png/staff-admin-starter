import EditPayrollClient from './EditPayrollClient';

export default function Page({ params }: { params: { id: string } }) {
  return (
    <div className="space-y-4">
      {/* 상단 제목: 스카이 → 인디고 그라데이션 + ID 보조 텍스트 */}
      <h1 className="text-2xl font-extrabold">
        <span className="title-gradient">급여 수정</span>
        <span className="ml-2 align-middle text-sm text-gray-500">#{params.id}</span>
      </h1>

      <EditPayrollClient id={params.id} />
    </div>
  );
}

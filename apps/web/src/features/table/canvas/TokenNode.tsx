import { memo } from "react";
import { Circle, Group, Image as KImage, Rect, Text } from "react-konva";
import type Konva from "konva";
import useImage from "use-image";
import type { TokenDto } from "../types";

interface Props {
  token: TokenDto;
  cell: number;
  selected: boolean;
  draggable: boolean;
  /** GM sees hidden tokens ghosted. */
  ghost: boolean;
  onSelect(id: string): void;
  onDragEnd(id: string, x: number, y: number): void;
}

function TokenNodeImpl({ token, cell, selected, draggable, ghost, onSelect, onDragEnd }: Props) {
  const [img] = useImage(token.imageUrl ?? "", "anonymous");
  const px = Math.max(8, token.size * cell);
  const half = px / 2;
  const border = Math.max(2, px * 0.05);
  const isCircle = token.shape === "circle";

  const clip = (ctx: Konva.Context) => {
    if (isCircle) ctx.arc(0, 0, half - border / 2, 0, Math.PI * 2);
    else ctx.rect(-half + border / 2, -half + border / 2, px - border, px - border);
  };

  return (
    <Group
      x={token.x}
      y={token.y}
      draggable={draggable}
      opacity={ghost ? 0.45 : 1}
      onMouseDown={(e) => {
        e.cancelBubble = true;
        onSelect(token.id);
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        onSelect(token.id);
      }}
      onDragStart={(e) => {
        e.cancelBubble = true;
        onSelect(token.id);
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        onDragEnd(token.id, e.target.x(), e.target.y());
      }}
      name="token"
    >
      <Group rotation={token.rotation}>
        {isCircle ? (
          <Circle radius={half} fill={token.color} />
        ) : (
          <Rect x={-half} y={-half} width={px} height={px} fill={token.color} cornerRadius={px * 0.08} />
        )}
        {img && (
          <Group clipFunc={clip}>
            <KImage image={img} x={-half} y={-half} width={px} height={px} />
          </Group>
        )}
        {!img && (
          <Text
            text={token.name.slice(0, 2).toUpperCase()}
            width={px}
            height={px}
            x={-half}
            y={-half}
            align="center"
            verticalAlign="middle"
            fontSize={px * 0.36}
            fontStyle="bold"
            fill="#f6efe0"
            listening={false}
          />
        )}
        {isCircle ? (
          <Circle radius={half - border / 2} stroke={token.borderColor} strokeWidth={border} />
        ) : (
          <Rect x={-half + border / 2} y={-half + border / 2} width={px - border} height={px - border} stroke={token.borderColor} strokeWidth={border} cornerRadius={px * 0.08} />
        )}
      </Group>
      {selected && (
        <Rect x={-half - 4} y={-half - 4} width={px + 8} height={px + 8} stroke="#8fa8ff" strokeWidth={2} dash={[6, 4]} listening={false} />
      )}
      {(token.locked || token.hidden) && (
        <Text text={`${token.hidden ? "👁‍🗨" : ""}${token.locked ? "🔒" : ""}`} x={half - 14} y={-half - 4} fontSize={14} listening={false} />
      )}
      {token.showName && (
        <Group y={half + 3} listening={false}>
          <Text
            text={token.name}
            width={Math.max(px * 1.8, 90)}
            x={-Math.max(px * 1.8, 90) / 2}
            align="center"
            fontSize={Math.max(11, Math.min(16, cell * 0.22))}
            fill="#f6efe0"
            shadowColor="#000"
            shadowBlur={4}
            shadowOpacity={0.9}
            ellipsis
            wrap="none"
          />
        </Group>
      )}
    </Group>
  );
}

export const TokenNode = memo(TokenNodeImpl);

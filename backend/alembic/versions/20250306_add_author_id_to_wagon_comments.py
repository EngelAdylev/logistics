"""add author_id to wagon_comments

Revision ID: 20250306_author_id
Revises:
Create Date: 2025-03-06

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20250306_author_id"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    r = conn.execute(sa.text("""
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'wagon_comments' AND column_name = 'author_id'
    """))
    if r.fetchone() is None:
        op.add_column(
            "wagon_comments",
            sa.Column("author_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        )
        op.create_index(op.f("ix_wagon_comments_author_id"), "wagon_comments", ["author_id"], unique=False)
    # Backfill: сопоставить author_name с users.login
    conn.execute(sa.text("""
        UPDATE wagon_comments c
        SET author_id = u.id
        FROM users u
        WHERE c.author_name = u.login AND c.author_id IS NULL
    """))


def downgrade() -> None:
    op.drop_index(op.f("ix_wagon_comments_author_id"), table_name="wagon_comments", if_exists=True)
    op.drop_column("wagon_comments", "author_id")

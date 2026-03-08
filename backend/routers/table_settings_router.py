from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
from database import get_db
from auth import get_current_user
from schemas import TableSettingsOut, TableSettingsUpdateRequest
from table_settings import validate_visible_columns, get_default_visible_columns, ALLOWED_TABLE_KEYS

router = APIRouter(prefix="/table-settings", tags=["table-settings"])


def _get_preference(db: Session, user_id, table_key: str) -> Optional[models.UserTablePreference]:
    return (
        db.query(models.UserTablePreference)
        .filter(
            models.UserTablePreference.user_id == user_id,
            models.UserTablePreference.table_key == table_key,
        )
        .first()
    )


@router.get("/{table_key}", response_model=TableSettingsOut)
def get_table_settings(
    table_key: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Получить настройки видимости колонок для текущего пользователя."""
    if table_key not in ALLOWED_TABLE_KEYS:
        raise HTTPException(status_code=400, detail="Unknown table_key")
    pref = _get_preference(db, current_user.id, table_key)
    if pref:
        return TableSettingsOut(table_key=table_key, visible_columns=pref.visible_columns)
    return TableSettingsOut(
        table_key=table_key,
        visible_columns=get_default_visible_columns(table_key),
    )


@router.put("/{table_key}", response_model=TableSettingsOut)
def update_table_settings(
    table_key: str,
    body: TableSettingsUpdateRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Сохранить настройки видимости колонок."""
    if table_key not in ALLOWED_TABLE_KEYS:
        raise HTTPException(status_code=400, detail="Unknown table_key")
    try:
        cleaned = validate_visible_columns(table_key, body.visible_columns)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    pref = _get_preference(db, current_user.id, table_key)
    if pref:
        pref.visible_columns = cleaned
        db.commit()
        db.refresh(pref)
        return TableSettingsOut(table_key=table_key, visible_columns=pref.visible_columns)
    new_pref = models.UserTablePreference(
        user_id=current_user.id,
        table_key=table_key,
        visible_columns=cleaned,
    )
    db.add(new_pref)
    db.commit()
    db.refresh(new_pref)
    return TableSettingsOut(table_key=table_key, visible_columns=new_pref.visible_columns)

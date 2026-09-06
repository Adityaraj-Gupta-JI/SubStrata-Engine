from pydantic import BaseModel, Field
from typing import List, Dict, Any, Literal

class DynamicAttribute(BaseModel):
    name: str = Field(description="The name of the custom attribute (e.g., 'roast_level', 'shoe_size').")
    data_type: Literal['string', 'number', 'boolean', 'json'] = Field(description="The strict data type of the attribute.")
    value: Any = Field(description="The actual value for this product.")

class ProductEntry(BaseModel):
    sku: str = Field(description="A unique stock keeping unit string.")
    name: str = Field(description="The name of the product.")
    base_price: float = Field(description="The base price of the product. Must be >= 0.")
    attributes: List[DynamicAttribute] = Field(description="List of custom attributes specific to this business model.")

class VendorSubscriptionModel(BaseModel):
    products: List[ProductEntry] = Field(description="A list of products to initialize for this vendor's subscription box.")